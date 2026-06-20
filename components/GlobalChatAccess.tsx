"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ChatClient from "@/app/zangochap-manager/chat/ChatClient";
import type { ChatSnapshot } from "@/modules/chat/actions";
import type { SidebarCounts } from "@/modules/orders/actions/sidebar-counts";
import styles from "./GlobalChatAccess.module.css";

const CHAT_PATH = "/zangochap-manager/chat";
const CHAT_SNAPSHOT_API = "/api/chat/snapshot";

async function fetchChatSnapshot(signal?: AbortSignal) {
  const response = await fetch(CHAT_SNAPSHOT_API, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Chat indisponible.");
  }
  return payload as ChatSnapshot;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export default function GlobalChatAccess() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      try {
        const response = await fetch("/api/sidebar-counts", { cache: "no-store" });
        if (!response.ok) return;
        const counts = (await response.json()) as Partial<SidebarCounts>;
        if (isMounted) setUnread(Math.max(0, counts.chatUnread || 0));
      } catch {
        // The chat shortcut must never block the current workspace screen.
      } finally {
        if (isMounted) timeoutId = setTimeout(refresh, 10_000);
      }
    };

    refresh();
    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== "c" || isEditableTarget(event.target)) return;
      event.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!isOpen || snapshot) return;

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    setSnapshotError("");

    fetchChatSnapshot(controller.signal)
      .then((next) => {
        if (isMounted) setSnapshot(next);
      })
      .catch((error) => {
        if (!isMounted) return;
        setSnapshotError(
          error instanceof DOMException && error.name === "AbortError"
            ? "Le chargement du chat a expire. Reessayez."
            : error instanceof Error
              ? error.message
              : "Chat indisponible.",
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isOpen, snapshot, loadAttempt]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (pathname === CHAT_PATH) return null;

  const unreadLabel = unread > 99 ? "99+" : String(unread);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`${styles.floatingChat} ${unread > 0 ? styles.pulse : ""}`}
        aria-label={unread > 0 ? `Ouvrir le chat equipe, ${unreadLabel} message(s) non lu(s)` : "Ouvrir le chat equipe"}
        title="Ouvrir le chat equipe en modal (Alt+C)"
      >
        <span className={styles.iconWrap}>
          <MessageCircle size={18} aria-hidden="true" />
        </span>
        <span className={styles.label}>
          <strong>Chat</strong>
          <span>Alt+C</span>
        </span>
        {unread > 0 && <span className={styles.badge}>{unreadLabel}</span>}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={styles.modalBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label="Chat equipe"
          >
            <button className={styles.backdropClose} type="button" onClick={() => setIsOpen(false)} aria-label="Fermer le chat" />
            <motion.div
              className={styles.modalPanel}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className={styles.modalTopbar}>
                <div>
                  <strong>Chat equipe</strong>
                  <span>Disponible depuis partout</span>
                </div>
                <div className={styles.modalActions}>
                  <Link href={CHAT_PATH} title="Ouvrir la page complete">
                    <ExternalLink size={16} />
                  </Link>
                  <button type="button" onClick={() => setIsOpen(false)} title="Fermer">
                    <X size={17} />
                  </button>
                </div>
              </div>
              {snapshot ? (
                <ChatClient
                  initialSnapshot={snapshot}
                  variant="modal"
                  onClose={() => setIsOpen(false)}
                  fetchSnapshot={fetchChatSnapshot}
                />
              ) : (
                <div className={styles.modalState}>
                  <MessageCircle size={30} />
                  <strong>{snapshotError || "Chargement du chat..."}</strong>
                  {snapshotError && (
                    <button type="button" onClick={() => {
                      setSnapshot(null);
                      setSnapshotError("");
                      setLoadAttempt((attempt) => attempt + 1);
                    }}>
                      Reessayer
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
