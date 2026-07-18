"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { CHANGELOG_ENTRIES, ChangelogEntry } from "@/modules/changelog/entries";

const SEEN_STORAGE_KEY = "zango:changelog-seen";

function readSeenIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function markSeen(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    const merged = Array.from(new Set([...readSeenIds(), ...ids]));
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(merged.slice(-100)));
  } catch {
    // localStorage indisponible : le popup reviendra, sans gravité
  }
}

export default function WhatsNewModal({ role }: { role: string }) {
  const roleKey = String(role || "").toLowerCase();
  const [unseen, setUnseen] = useState<ChangelogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const seen = new Set(readSeenIds());
    const pending = CHANGELOG_ENTRIES.filter(
      (entry) => !seen.has(entry.id) && (!entry.roles || entry.roles.includes(roleKey)),
    );
    if (!pending.length) return;
    setUnseen(pending);
    // Petit délai pour laisser l'interface se poser avant l'annonce
    const timeout = window.setTimeout(() => setIsOpen(true), 900);
    return () => window.clearTimeout(timeout);
  }, [roleKey]);

  const entry = unseen[0] || null;

  const close = useMemo(() => () => {
    markSeen(unseen.map((e) => e.id));
    setIsOpen(false);
  }, [unseen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  if (!entry) return null;

  const handleAction = () => {
    close();
    if (entry.action?.event) {
      window.dispatchEvent(new Event(entry.action.event));
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[2147482000] flex items-center justify-center bg-[#1A1410]/80 backdrop-blur-[3px] px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Nouveautés"
        >
          <motion.div
            initial={{ scale: 0.94, y: 26 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 14 }}
            transition={{ type: "spring", damping: 20, stiffness: 210 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_28px_90px_rgba(0,0,0,0.45)]"
          >
            {/* En-tête */}
            <div className="relative bg-[#1A1410] px-6 pt-7 pb-6 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,#D4541C55,transparent_55%)]" />
              <button
                type="button"
                onClick={close}
                className="absolute right-4 top-4 z-10 w-9 h-9 rounded-lg bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
                aria-label="Fermer"
              >
                <X size={17} />
              </button>
              <div className="relative">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#D4541C] text-white text-[10px] font-black uppercase tracking-[0.18em]">
                  <Sparkles size={11} /> Nouveauté
                </div>
                <h2 className="mt-3 text-[26px] font-black leading-tight text-white">{entry.title}</h2>
                {entry.subtitle && (
                  <p className="mt-1 text-[13px] font-semibold text-white/60">{entry.subtitle}</p>
                )}
              </div>
            </div>

            {/* Points clés */}
            <div className="p-6 space-y-4 max-h-[46dvh] overflow-y-auto">
              {entry.highlights.map((highlight, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + idx * 0.08 }}
                  className="flex items-start gap-3"
                >
                  <div className="mt-0.5 w-6 h-6 rounded-lg bg-[#D4541C]/10 text-[#D4541C] flex items-center justify-center shrink-0">
                    <Check size={14} strokeWidth={3} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-black text-[#1A1410]">{highlight.title}</p>
                    <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-[#6B4838]">{highlight.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 space-y-2.5">
              {entry.action && (
                entry.action.href ? (
                  <Link
                    href={entry.action.href}
                    onClick={handleAction}
                    className="w-full py-3 bg-[#D4541C] hover:bg-[#B8451A] text-white rounded-xl text-[13px] font-black flex items-center justify-center gap-2 transition-colors shadow-lg shadow-orange-500/25 no-underline"
                  >
                    {entry.action.label} <ArrowRight size={15} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleAction}
                    className="w-full py-3 bg-[#D4541C] hover:bg-[#B8451A] text-white rounded-xl text-[13px] font-black flex items-center justify-center gap-2 transition-colors shadow-lg shadow-orange-500/25"
                  >
                    {entry.action.label} <ArrowRight size={15} />
                  </button>
                )
              )}
              <button
                type="button"
                onClick={close}
                className="w-full py-2.5 rounded-xl text-[12px] font-bold text-[#8A7A6D] hover:text-[#1A1410] hover:bg-[#FAF6F1] transition-colors"
              >
                {unseen.length > 1 ? `C'est noté (${unseen.length} nouveautés)` : "C'est noté"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
