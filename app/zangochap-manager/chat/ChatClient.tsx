"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Hash,
  Lock,
  Menu,
  MessageCircle,
  PanelLeftClose,
  Pin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
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

const STAFF_ROLES = ["ADMIN", "COMMERCIAL", "COMPTABLE", "PACKING", "COLLECTION", "STOCK", "LIVREUR", "DEVELOPER"] as const;
type RoleKey = typeof STAFF_ROLES[number];

const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
const fullDateFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function formatTime(value: string) {
  return timeFormatter.format(new Date(value));
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}

function getDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (getDayKey(value) === getDayKey(today.toISOString())) return "Aujourd'hui";
  if (getDayKey(value) === getDayKey(yesterday.toISOString())) return "Hier";
  const label = fullDateFormatter.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getInitials(user: Pick<ChatUserView, "name" | "initials">) {
  return user.initials || user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function getRoomLabel(room: ChatRoomKey, role: RoleKey, peer?: ChatUserView) {
  if (room === "GENERAL") return "Canal général";
  if (room === "ROLE") return ROLE_LABELS[role] || role;
  return peer?.name || "Message direct";
}

function isDirectMessageWith(item: ChatMessageView, currentUserId: string, peerId: string) {
  return item.scope === "DIRECT" && (
    (item.senderId === currentUserId && item.recipientId === peerId)
    || (item.senderId === peerId && item.recipientId === currentUserId)
  );
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
  const [peopleSearch, setPeopleSearch] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(new Date());
  const [reportingAlert, setReportingAlert] = useState<ChatMessageView | null>(null);
  const [contactOutcome, setContactOutcome] = useState("Client contacte");
  const [contactReport, setContactReport] = useState("");
  const { activeAlert, pendingCount, enqueueAlert, closeActiveAlert } = useRiderAlertQueue();
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const refresh = useCallback(async (showActivity = false) => {
    if (showActivity) setIsRefreshing(true);
    try {
      const next = fetchSnapshot ? await fetchSnapshot() : await getChatSnapshot();
      setSnapshot(next);
      setLastRefreshAt(new Date());
    } finally {
      if (showActivity) setIsRefreshing(false);
    }
  }, [fetchSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => refresh().catch(() => undefined), 8000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const roomMessages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.messages
      .filter((item) => {
        if (room === "GENERAL") return item.scope === "GENERAL";
        if (room === "ROLE") return item.scope === "ROLE" && item.targetRole === selectedRole;
        return selectedPeerId && isDirectMessageWith(item, currentUser.id, selectedPeerId);
      })
      .filter((item) => !query || item.body.toLowerCase().includes(query) || item.senderName.toLowerCase().includes(query))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [snapshot.messages, room, selectedRole, selectedPeerId, currentUser.id, search]);

  const filteredPeers = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    return peers
      .filter((user) => !query || user.name.toLowerCase().includes(query) || (ROLE_LABELS[user.role] || user.role).toLowerCase().includes(query))
      .sort((a, b) => {
        const aLatest = snapshot.messages.filter((item) => isDirectMessageWith(item, currentUser.id, a.id)).at(-1)?.createdAt || "";
        const bLatest = snapshot.messages.filter((item) => isDirectMessageWith(item, currentUser.id, b.id)).at(-1)?.createdAt || "";
        return bLatest.localeCompare(aLatest) || a.name.localeCompare(b.name);
      });
  }, [peers, peopleSearch, snapshot.messages, currentUser.id]);

  const directMeta = useMemo(() => new Map(peers.map((peer) => {
    const messages = snapshot.messages.filter((item) => isDirectMessageWith(item, currentUser.id, peer.id));
    const latest = messages.at(-1);
    const unread = messages.filter((item) => item.senderId === peer.id && !item.readByMe).length;
    return [peer.id, { latest, unread }];
  })), [peers, snapshot.messages, currentUser.id]);

  const generalUnread = useMemo(() => snapshot.messages.filter((item) => (
    item.scope === "GENERAL" && item.senderId !== currentUser.id && !item.readByMe
  )).length, [snapshot.messages, currentUser.id]);

  const roleUnread = useMemo(() => new Map(STAFF_ROLES.map((roleKey) => [
    roleKey,
    snapshot.messages.filter((item) => item.scope === "ROLE" && item.targetRole === roleKey && item.senderId !== currentUser.id && !item.readByMe).length,
  ])), [snapshot.messages, currentUser.id]);

  const pinnedMessages = useMemo(() => roomMessages.filter((item) => item.isPinned).slice(-3), [roomMessages]);
  const unreadInRoom = useMemo(
    () => roomMessages.filter((item) => item.senderId !== currentUser.id && !item.readByMe).length,
    [roomMessages, currentUser.id],
  );

  const selectRoom = (nextRoom: ChatRoomKey, options?: { role?: RoleKey; peerId?: string }) => {
    setRoom(nextRoom);
    if (options?.role) setSelectedRole(options.role);
    if (options?.peerId) setSelectedPeerId(options.peerId);
    setSearch("");
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [roomMessages.length, room]);

  useEffect(() => {
    const unreadIds = roomMessages.filter((item) => item.senderId !== currentUser.id && !item.readByMe).map((item) => item.id);
    if (unreadIds.length === 0) return;
    const timeout = window.setTimeout(() => {
      markChatMessagesRead(unreadIds).then(() => {
        setSnapshot((current) => ({
          ...current,
          unreadCount: Math.max(0, current.unreadCount - unreadIds.length),
          messages: current.messages.map((item) => unreadIds.includes(item.id) ? { ...item, readByMe: true } : item),
        }));
      }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [roomMessages, currentUser.id]);

  useEffect(() => {
    const newRiderMessages = snapshot.messages.filter((item) => (
      item.senderRole === "LIVREUR" && item.senderId !== currentUser.id && !item.readByMe
      && !notifiedRiderMessagesRef.current.has(item.id)
    ));
    snapshot.messages.forEach((item) => notifiedRiderMessagesRef.current.add(item.id));
    if (newRiderMessages.length === 0) return;
    const latest = newRiderMessages[newRiderMessages.length - 1];
    if (hasSeenRiderAlert(latest.id)) return;
    markRiderAlertSeen(latest.id);
    const preview = latest.body.replace(/\s+/g, " ").trim().slice(0, 90);
    const alertMessage = `${latest.senderName}: ${preview}`;
    playRiderMessageSound();
    showToast(`Message livreur - ${alertMessage}`, "success");
    showBrowserNotification("Message livreur ZangoChap", alertMessage);
    enqueueAlert({ id: latest.id, senderName: latest.senderName, senderPhone: latest.senderPhone, body: latest.body, createdAt: latest.createdAt });
  }, [snapshot.messages, currentUser.id, enqueueAlert, showToast]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [message]);

  const handleSend = () => {
    const body = message.trim();
    if (!body || (room === "DIRECT" && !selectedPeerId)) return;
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

  const extractOrderRef = (body: string) => body.match(/\[ALERTE LIVREUR\]\s+Commande\s+([^\s\n]+)/i)?.[1]?.trim();

  const handleSubmitContactReport = () => {
    if (!reportingAlert) return;
    startTransition(async () => {
      try {
        await recordCommercialContactReport({ orderRef: extractOrderRef(reportingAlert.body), outcome: contactOutcome, report: contactReport });
        showToast("Rapport client enregistré", "success");
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
    startTransition(async () => {
      try {
        const result = await acceptOrderAfterCommercialIntervention({ orderRef: extractOrderRef(reportingAlert.body), report: contactReport });
        showToast(result.alreadyAccepted ? "Cette commande est déjà confirmée" : `Livreur notifié: ${result.deliverymanName}`, "success");
        setReportingAlert(null);
        setContactReport("");
        setContactOutcome("Client contacte");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Confirmation impossible", "error");
      }
    });
  };

  const canDeleteMessage = (item: ChatMessageView) => item.senderId === currentUser.id || currentUser.role === "ADMIN" || currentUser.role === "DEVELOPER";
  const roomLabel = getRoomLabel(room, selectedRole, selectedPeer);

  return (
    <div className={`chat-shell ${variant === "modal" ? "chat-shell-modal" : ""} ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <AnimatePresence>
        {activeAlert && <RiderMessageAlertOverlay alert={activeAlert} pendingCount={pendingCount} onClose={closeActiveAlert} />}
      </AnimatePresence>

      <button className="chat-mobile-scrim" type="button" aria-label="Fermer les conversations" onClick={() => setIsSidebarOpen(false)} />

      <aside className="chat-sidebar" aria-label="Conversations">
        <div className="chat-side-brand">
          <div className="chat-brand-mark"><MessageCircle size={18} /></div>
          <div><strong>ZangoChat</strong><span>Centre d&apos;équipe</span></div>
          <button className="chat-mobile-side-close" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="Fermer"><PanelLeftClose size={18} /></button>
        </div>

        <div className="chat-side-search">
          <Search size={15} />
          <input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="Rechercher une personne" aria-label="Rechercher une personne" />
          {peopleSearch && <button type="button" onClick={() => setPeopleSearch("")} aria-label="Effacer"><X size={13} /></button>}
        </div>

        <nav className="chat-side-content">
          <div className="chat-section-heading"><span>Espaces</span><small>{snapshot.unreadCount > 0 ? `${snapshot.unreadCount} non lu${snapshot.unreadCount > 1 ? "s" : ""}` : "À jour"}</small></div>
          <button className={`chat-room-btn ${room === "GENERAL" ? "active" : ""}`} onClick={() => selectRoom("GENERAL")}>
            <span className="chat-nav-icon"><Hash size={16} /></span>
            <span className="chat-nav-copy"><strong>Canal général</strong><small>Toute l&apos;équipe</small></span>
            {generalUnread > 0 && <b>{generalUnread}</b>}
          </button>

          <div className="chat-section-heading"><span>Équipes</span></div>
          <div className="chat-role-list">
            {STAFF_ROLES.map((roleKey) => {
              const unread = roleUnread.get(roleKey) || 0;
              return (
                <button key={roleKey} className={`chat-role-btn ${room === "ROLE" && selectedRole === roleKey ? "active" : ""}`} onClick={() => selectRoom("ROLE", { role: roleKey })}>
                  <span className="chat-role-dot" />
                  <span>{ROLE_LABELS[roleKey] || roleKey}</span>
                  {unread > 0 && <b>{unread}</b>}
                </button>
              );
            })}
          </div>

          <div className="chat-section-heading"><span>Messages directs</span><small>{filteredPeers.length}</small></div>
          <div className="chat-people-list">
            {filteredPeers.length === 0 ? <div className="chat-no-person">Aucun membre trouvé</div> : filteredPeers.map((user) => {
              const meta = directMeta.get(user.id);
              return (
                <button key={user.id} className={`chat-person ${room === "DIRECT" && selectedPeerId === user.id ? "active" : ""}`} onClick={() => selectRoom("DIRECT", { peerId: user.id })}>
                  <span className={`chat-avatar ${user.isPaused ? "paused" : ""}`}>{getInitials(user)}<i /></span>
                  <span className="chat-person-copy">
                    <span className="chat-person-line"><strong>{user.name}</strong>{meta?.latest && <time>{formatShortDate(meta.latest.createdAt)}</time>}</span>
                    <span className="chat-person-line"><small>{meta?.latest?.body || ROLE_LABELS[user.role] || user.role}</small>{meta && meta.unread > 0 && <b>{meta.unread}</b>}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="chat-current-user">
          <span className="chat-avatar self">{getInitials({ name: currentUser.name, initials: null })}</span>
          <span><strong>{currentUser.name}</strong><small>{currentUser.isPaused ? "En pause" : ROLE_LABELS[currentUser.role] || currentUser.role}</small></span>
          <span className={`chat-user-state ${currentUser.isPaused ? "paused" : ""}`} title={currentUser.isPaused ? "En pause" : "Disponible"} />
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-room-header">
          <button className="chat-menu-btn" type="button" onClick={() => setIsSidebarOpen(true)} aria-label="Ouvrir les conversations"><Menu size={20} /></button>
          <div className="chat-room-heading">
            <div className="chat-room-icon">{room === "GENERAL" ? <Hash size={19} /> : room === "ROLE" ? <Users size={19} /> : <Lock size={18} />}</div>
            <div><h2>{roomLabel}</h2><p>{room === "DIRECT" ? `${ROLE_LABELS[selectedPeer?.role || ""] || selectedPeer?.role || "Équipe"}${selectedPeer?.isPaused ? " · En pause" : ""}` : `${roomMessages.length} message${roomMessages.length > 1 ? "s" : ""}${unreadInRoom ? ` · ${unreadInRoom} non lu${unreadInRoom > 1 ? "s" : ""}` : ""}`}</p></div>
          </div>
          <div className="chat-header-actions">
            <label className={`chat-search ${search ? "active" : ""}`}>
              <Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher dans la conversation" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Effacer la recherche"><X size={13} /></button>}
            </label>
            <button className="chat-header-btn" onClick={() => refresh(true).catch(() => showToast("Actualisation impossible", "error"))} disabled={isRefreshing} title={`Actualisé à ${formatTime(lastRefreshAt.toISOString())}`} aria-label="Actualiser">
              <RefreshCw size={17} className={isRefreshing ? "spinning" : ""} />
            </button>
            {variant === "modal" && <button className="chat-header-btn" type="button" onClick={onClose} aria-label="Fermer le chat"><X size={18} /></button>}
          </div>
        </header>

        {pinnedMessages.length > 0 && (
          <div className="chat-pins">
            <span className="chat-pins-label"><Pin size={13} /> Épinglés</span>
            {pinnedMessages.map((item) => <div key={item.id} className="chat-pin" title={item.body}><span>{item.body}</span></div>)}
          </div>
        )}

        <div className="chat-messages" ref={listRef} aria-live="polite">
          {search && <div className="chat-search-result-count">{roomMessages.length} résultat{roomMessages.length > 1 ? "s" : ""} pour « {search} »</div>}
          {roomMessages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon"><MessageCircle size={30} /></div>
              <strong>{search ? "Aucun résultat" : "Commencez la conversation"}</strong>
              <span>{search ? "Essayez avec un autre mot-clé." : `Envoyez le premier message dans ${roomLabel}.`}</span>
            </div>
          ) : roomMessages.map((item, index) => {
            const isMine = item.senderId === currentUser.id;
            const previous = roomMessages[index - 1];
            const showDay = !previous || getDayKey(previous.createdAt) !== getDayKey(item.createdAt);
            const isGrouped = Boolean(previous && previous.senderId === item.senderId && !showDay && new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000);
            return (
              <React.Fragment key={item.id}>
                {showDay && <div className="chat-day-separator"><span>{formatDay(item.createdAt)}</span></div>}
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`chat-message ${isMine ? "mine" : ""} ${isGrouped ? "grouped" : ""} ${!item.readByMe && !isMine ? "unread" : ""}`}>
                  {!isGrouped && <div className="chat-message-avatar">{item.senderName.slice(0, 2).toUpperCase()}</div>}
                  <div className="chat-bubble">
                    {!isGrouped && <div className="chat-meta"><strong>{isMine ? "Vous" : item.senderName}</strong>{!isMine && <span>{ROLE_LABELS[item.senderRole] || item.senderRole}</span>}<time>{formatTime(item.createdAt)}</time>{item.isPinned && <Pin size={11} />}</div>}
                    <p>{item.body}</p>
                    <div className="chat-bubble-footer">
                      {isGrouped && <time>{formatTime(item.createdAt)}</time>}
                      {isMine && <span className="chat-delivery-state"><Check size={12} /> Envoyé</span>}
                    </div>
                    <div className="chat-message-actions">
                      {item.senderRole === "LIVREUR" && item.body.includes("[ALERTE LIVREUR]") && ["COMMERCIAL", "ADMIN", "DEVELOPER"].includes(currentUser.role) && <button onClick={() => setReportingAlert(item)} title="Traiter l'alerte"><MessageCircle size={14} /></button>}
                      {canDeleteMessage(item) && <button onClick={() => handleDelete(item.id)} title="Supprimer le message"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                </motion.div>
              </React.Fragment>
            );
          })}
        </div>

        <footer className="chat-composer">
          <div className="chat-composer-box">
            <textarea ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Écrire à ${roomLabel}...`} rows={1} maxLength={1200} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSend(); } }} />
            <div className="chat-compose-bottom">
              <div className="chat-compose-tools">
                {canPin && <button className={isPinned ? "active" : ""} onClick={() => setIsPinned((value) => !value)} type="button" title="Épingler le message"><Pin size={15} /><span>{isPinned ? "Épinglé" : "Épingler"}</span></button>}
                {room === "DIRECT" && <span><ShieldCheck size={14} /> Message direct</span>}
                <small>{message.length}/1200</small>
              </div>
              <span className="chat-enter-hint">Entrée pour envoyer · Maj + Entrée pour une ligne</span>
              <button className="chat-send" onClick={handleSend} disabled={isPending || !message.trim() || (room === "DIRECT" && !selectedPeerId)} aria-label="Envoyer le message"><Send size={17} /><span>Envoyer</span></button>
            </div>
          </div>
        </footer>
      </section>

      <AnimatePresence>
        {reportingAlert && (
          <motion.div className="chat-report-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="chat-report-modal" role="dialog" aria-modal="true" aria-label="Retour client" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}>
              <div className="chat-report-head"><div><span>Intervention commerciale</span><strong>{extractOrderRef(reportingAlert.body) || "Commande"}</strong><p>Consignez le retour client avant de poursuivre.</p></div><button type="button" onClick={() => setReportingAlert(null)} aria-label="Fermer"><X size={17} /></button></div>
              <label htmlFor="chat-contact-outcome">Résultat de l&apos;appel</label>
              <select id="chat-contact-outcome" value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value)}><option>Client contacte</option><option>Client injoignable</option><option>Refuse les frais livraison</option><option>Demande report</option><option>Commande annulee</option><option>Autre</option></select>
              <label htmlFor="chat-contact-report">Compte rendu</label>
              <textarea id="chat-contact-report" value={contactReport} onChange={(event) => setContactReport(event.target.value)} maxLength={800} placeholder="Ex: Le client refuse les frais de livraison et demande un geste commercial..." />
              <div className="chat-report-actions"><button type="button" onClick={() => setReportingAlert(null)}>Annuler</button><button className="accept" type="button" onClick={handleAcceptAfterIntervention} disabled={isPending}><CheckCircle2 size={15} /> Accepter</button><button type="button" onClick={handleSubmitContactReport} disabled={isPending || !contactReport.trim()}>Enregistrer</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
