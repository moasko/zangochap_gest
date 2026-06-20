"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence } from "framer-motion";
import { Bell, CheckCircle2, Hash, Lock, MessageCircle, Pin, RefreshCw, Search, Send, Shield, Trash2, Users, X } from "lucide-react";
import { ROLE_LABELS } from "@/lib/constants";
import {
  acceptOrderAfterCommercialIntervention,
  deleteChatMessage,
  getChatSnapshot,
  markChatMessagesRead,
  recordCommercialContactReport,
  sendChatMessage,
  type ChatMessageView,
  type ChatRoomKey,
  type ChatSnapshot,
  type ChatUserView,
} from "@/modules/chat/actions";
import { useToast } from "@/components/Toast";
import { hasSeenRiderAlert, markRiderAlertSeen, playRiderMessageSound, showBrowserNotification } from "@/lib/client-alerts";
import RiderMessageAlertOverlay from "@/components/RiderMessageAlertOverlay";
import { useRiderAlertQueue } from "@/lib/use-rider-alert-queue";

const STAFF_ROLES = ["ADMIN", "COMMERCIAL", "PACKING", "COLLECTION", "STOCK", "LIVREUR", "DEVELOPER"] as const;

type RoleKey = typeof STAFF_ROLES[number];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(user: ChatUserView) {
  return user.initials || user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function getRoomLabel(room: ChatRoomKey, role: RoleKey, peer?: ChatUserView) {
  if (room === "GENERAL") return "General";
  if (room === "ROLE") return ROLE_LABELS[role] || role;
  return peer?.name || "Direct";
}

type ChatClientProps = {
  initialSnapshot: ChatSnapshot;
  variant?: "page" | "modal";
  onClose?: () => void;
  fetchSnapshot?: () => Promise<ChatSnapshot>;
};

export default function ChatClient({ initialSnapshot, variant = "page", onClose, fetchSnapshot }: ChatClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [room, setRoom] = useState<ChatRoomKey>("GENERAL");
  const [selectedRole, setSelectedRole] = useState<RoleKey>(initialSnapshot.currentUser.role as RoleKey);
  const [selectedPeerId, setSelectedPeerId] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [reportingAlert, setReportingAlert] = useState<ChatMessageView | null>(null);
  const [contactOutcome, setContactOutcome] = useState("Client contacte");
  const [contactReport, setContactReport] = useState("");
  const { activeAlert, pendingCount, enqueueAlert, closeActiveAlert } = useRiderAlertQueue();
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const notifiedRiderMessagesRef = useRef(new Set(initialSnapshot.messages.map((item) => item.id)));
  const { showToast } = useToast();

  const currentUser = snapshot.currentUser;
  const canPin = currentUser.role === "ADMIN" || currentUser.role === "DEVELOPER";
  const peers = useMemo(
    () => snapshot.users.filter((user) => user.id !== currentUser.id),
    [snapshot.users, currentUser.id],
  );
  const selectedPeer = peers.find((user) => user.id === selectedPeerId);

  useEffect(() => {
    if (!selectedPeerId && peers[0]) setSelectedPeerId(peers[0].id);
  }, [peers, selectedPeerId]);

  const refresh = useCallback(async () => {
    const next = fetchSnapshot ? await fetchSnapshot() : await getChatSnapshot();
    setSnapshot(next);
  }, [fetchSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const roomMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.messages
      .filter((item) => {
        if (room === "GENERAL") return item.scope === "GENERAL";
        if (room === "ROLE") return item.scope === "ROLE" && item.targetRole === selectedRole;
        return item.scope === "DIRECT"
          && selectedPeerId
          && (
            (item.senderId === currentUser.id && item.recipientId === selectedPeerId)
            || (item.senderId === selectedPeerId && item.recipientId === currentUser.id)
          );
      })
      .filter((item) => {
        if (!q) return true;
        return item.body.toLowerCase().includes(q) || item.senderName.toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [snapshot.messages, room, selectedRole, selectedPeerId, currentUser.id, search]);

  const pinnedMessages = useMemo(
    () => roomMessages.filter((item) => item.isPinned).slice(-3),
    [roomMessages],
  );

  const unreadInRoom = useMemo(
    () => roomMessages.filter((item) => item.senderId !== currentUser.id && !item.readByMe).length,
    [roomMessages, currentUser.id],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [roomMessages.length, room]);

  useEffect(() => {
    const unreadIds = roomMessages
      .filter((item) => item.senderId !== currentUser.id && !item.readByMe)
      .map((item) => item.id);
    if (unreadIds.length === 0) return;

    const timeout = window.setTimeout(() => {
      markChatMessagesRead(unreadIds)
        .then(() => {
          setSnapshot((current) => ({
            ...current,
            unreadCount: Math.max(0, current.unreadCount - unreadIds.length),
            messages: current.messages.map((item) => (
              unreadIds.includes(item.id) ? { ...item, readByMe: true } : item
            )),
          }));
        })
        .catch(() => undefined);
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [roomMessages, currentUser.id]);

  useEffect(() => {
    const newRiderMessages = snapshot.messages.filter((item) => (
      item.senderRole === "LIVREUR"
      && item.senderId !== currentUser.id
      && !item.readByMe
      && !notifiedRiderMessagesRef.current.has(item.id)
    ));

    snapshot.messages.forEach((item) => notifiedRiderMessagesRef.current.add(item.id));
    if (newRiderMessages.length === 0) return;

    const latest = newRiderMessages[newRiderMessages.length - 1];
    if (hasSeenRiderAlert(latest.id)) return;

    markRiderAlertSeen(latest.id);
    const preview = latest.body.replace(/\s+/g, " ").trim().slice(0, 90);
    const message = `${latest.senderName}: ${preview}`;

    playRiderMessageSound();
    showToast(`Message livreur - ${message}`, "success");
    showBrowserNotification("Message livreur ZangoChap", message);
    enqueueAlert({
      id: latest.id,
      senderName: latest.senderName,
      senderPhone: latest.senderPhone,
      body: latest.body,
      createdAt: latest.createdAt,
    });
  }, [snapshot.messages, currentUser.id, enqueueAlert, showToast]);

  const handleSend = () => {
    const body = message.trim();
    if (!body) return;

    startTransition(async () => {
      try {
        await sendChatMessage({
          body,
          scope: room,
          targetRole: room === "ROLE" ? selectedRole : null,
          recipientId: room === "DIRECT" ? selectedPeerId : null,
          isPinned,
        });
        setMessage("");
        setIsPinned(false);
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Erreur chat", "error");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteChatMessage(id);
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Suppression impossible", "error");
      }
    });
  };

  const extractOrderRef = (body: string) => {
    const match = body.match(/\[ALERTE LIVREUR\]\s+Commande\s+([^\s\n]+)/i);
    return match?.[1]?.trim();
  };

  const handleSubmitContactReport = () => {
    if (!reportingAlert) return;
    const orderRef = extractOrderRef(reportingAlert.body);
    startTransition(async () => {
      try {
        await recordCommercialContactReport({
          orderRef,
          outcome: contactOutcome,
          report: contactReport,
        });
        showToast("Rapport client enregistre", "success");
        setReportingAlert(null);
        setContactReport("");
        setContactOutcome("Client contacte");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Rapport impossible", "error");
      }
    });
  };

  const handleAcceptAfterIntervention = () => {
    if (!reportingAlert) return;
    const orderRef = extractOrderRef(reportingAlert.body);
    startTransition(async () => {
      try {
        const result = await acceptOrderAfterCommercialIntervention({
          orderRef,
          report: contactReport,
        });
        showToast(
          result.alreadyAccepted
            ? "Cette commande est deja confirmee"
            : `Livreur notifie: ${result.deliverymanName}`,
          "success",
        );
        setReportingAlert(null);
        setContactReport("");
        setContactOutcome("Client contacte");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Confirmation impossible", "error");
      }
    });
  };

  const canDeleteMessage = (item: ChatMessageView) => (
    item.senderId === currentUser.id || currentUser.role === "ADMIN" || currentUser.role === "DEVELOPER"
  );

  return (
    <div className={`chat-shell ${variant === "modal" ? "chat-shell-modal" : ""}`}>
      <AnimatePresence>
        {activeAlert && (
          <RiderMessageAlertOverlay
            alert={activeAlert}
            pendingCount={pendingCount}
            onClose={closeActiveAlert}
          />
        )}
      </AnimatePresence>

      <aside className="chat-sidebar">
        <div className="chat-side-header">
          <div>
            <div className="chat-kicker">Canaux</div>
            <div className="chat-title-small">Equipe ZangoChap</div>
          </div>
          <button className="chat-icon-btn" onClick={() => refresh()} disabled={isPending} title="Actualiser">
            <RefreshCw size={16} />
          </button>
        </div>

        <button className={`chat-room-btn ${room === "GENERAL" ? "active" : ""}`} onClick={() => setRoom("GENERAL")}>
          <Hash size={16} />
          <span>General</span>
          {snapshot.unreadCount > 0 && <b>{snapshot.unreadCount}</b>}
        </button>

        <div className="chat-section-label">Roles</div>
        <div className="chat-role-grid">
          {STAFF_ROLES.map((roleKey) => (
            <button
              key={roleKey}
              className={`chat-chip ${room === "ROLE" && selectedRole === roleKey ? "active" : ""}`}
              onClick={() => {
                setRoom("ROLE");
                setSelectedRole(roleKey);
              }}
            >
              {ROLE_LABELS[roleKey] || roleKey}
            </button>
          ))}
        </div>

        <div className="chat-section-label">Direct</div>
        <div className="chat-people-list">
          {peers.map((user) => (
            <button
              key={user.id}
              className={`chat-person ${room === "DIRECT" && selectedPeerId === user.id ? "active" : ""}`}
              onClick={() => {
                setRoom("DIRECT");
                setSelectedPeerId(user.id);
              }}
            >
              <span className="chat-avatar">{getInitials(user)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>
                  {ROLE_LABELS[user.role] || user.role}
                  {user.isPaused ? " · En pause" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-main">
        <div className="chat-room-header">
          <div className="chat-room-heading">
            <div className="chat-room-icon">
              {room === "GENERAL" ? <Hash size={18} /> : room === "ROLE" ? <Users size={18} /> : <Lock size={18} />}
            </div>
            <div>
              <h2>{getRoomLabel(room, selectedRole, selectedPeer)}</h2>
              <p>{roomMessages.length} messages{unreadInRoom > 0 ? ` · ${unreadInRoom} non lus` : ""}</p>
            </div>
          </div>
          <div className="chat-search">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher..." />
          </div>
          {variant === "modal" && (
            <button className="chat-modal-close" type="button" onClick={onClose} title="Fermer le chat">
              <X size={18} />
            </button>
          )}
        </div>

        {pinnedMessages.length > 0 && (
          <div className="chat-pins">
            {pinnedMessages.map((item) => (
              <div key={item.id} className="chat-pin">
                <Pin size={13} />
                <span>{item.body}</span>
              </div>
            ))}
          </div>
        )}

        <div className="chat-messages" ref={listRef}>
          {roomMessages.length === 0 ? (
            <div className="chat-empty">
              <MessageCircle size={34} />
              <strong>Aucun message</strong>
              <span>{getRoomLabel(room, selectedRole, selectedPeer)}</span>
            </div>
          ) : (
            roomMessages.map((item) => {
              const isMine = item.senderId === currentUser.id;
              return (
                <div key={item.id} className={`chat-message ${isMine ? "mine" : ""} ${!item.readByMe && !isMine ? "unread" : ""}`}>
                  <div className="chat-message-avatar">{item.senderName.slice(0, 2).toUpperCase()}</div>
                  <div className="chat-bubble">
                    <div className="chat-meta">
                      <strong>{item.senderName}</strong>
                      <span>{ROLE_LABELS[item.senderRole] || item.senderRole}</span>
                      <time>{formatTime(item.createdAt)}</time>
                      {item.isPinned && <Pin size={12} />}
                    </div>
                    <p>{item.body}</p>
                    <div className="chat-message-actions">
                      {item.senderRole === "LIVREUR" && item.body.includes("[ALERTE LIVREUR]") && ["COMMERCIAL", "ADMIN", "DEVELOPER"].includes(currentUser.role) && (
                        <button onClick={() => setReportingAlert(item)} title="Rapport client">
                          <MessageCircle size={13} />
                        </button>
                      )}
                      {canDeleteMessage(item) && (
                        <button onClick={() => handleDelete(item.id)} title="Supprimer">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="chat-composer">
          <div className="chat-compose-tools">
            <span><Bell size={13} /> {getRoomLabel(room, selectedRole, selectedPeer)}</span>
            {canPin && (
              <button className={isPinned ? "active" : ""} onClick={() => setIsPinned((value) => !value)} type="button">
                <Pin size={13} /> Epingler
              </button>
            )}
            {room === "DIRECT" && <span><Shield size={13} /> Direct</span>}
          </div>
          <div className="chat-compose-row">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ecrire un message..."
              rows={1}
              maxLength={1200}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <button className="chat-send" onClick={handleSend} disabled={isPending || !message.trim()}>
              <Send size={17} />
            </button>
          </div>
        </footer>
      </section>

      {reportingAlert && (
        <div className="chat-report-backdrop">
          <div className="chat-report-modal">
            <div className="chat-report-head">
              <div>
                <span>Retour client</span>
                <strong>{extractOrderRef(reportingAlert.body) || "Commande"}</strong>
              </div>
              <button type="button" onClick={() => setReportingAlert(null)}>x</button>
            </div>
            <label>Resultat</label>
            <select value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value)}>
              <option>Client contacte</option>
              <option>Client injoignable</option>
              <option>Refuse les frais livraison</option>
              <option>Demande report</option>
              <option>Commande annulee</option>
              <option>Autre</option>
            </select>
            <label>Mini rapport</label>
            <textarea
              value={contactReport}
              onChange={(event) => setContactReport(event.target.value)}
              maxLength={800}
              placeholder="Ex: Le client refuse de payer la livraison, demande un geste commercial..."
            />
            <div className="chat-report-actions">
              <button type="button" onClick={() => setReportingAlert(null)}>Annuler</button>
              <button className="accept" type="button" onClick={handleAcceptAfterIntervention} disabled={isPending}>
                <CheckCircle2 size={15} /> Accepte
              </button>
              <button type="button" onClick={handleSubmitContactReport} disabled={isPending || !contactReport.trim()}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
