"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  AlarmClock,
  Bell,
  BellOff,
  Check,
  Link as LinkIcon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCcw,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { playReminderAlarmSound, showBrowserNotification } from "@/lib/client-alerts";
import { cn } from "@/lib/utils";
import {
  deleteMyStaffNote,
  getMyStaffNotes,
  patchMyStaffNote,
  upsertMyStaffNote,
} from "@/modules/notes/actions";
import type { StaffNote, StaffNotePriority } from "@/modules/notes/types";

/** Dispatch this event anywhere to open the staff notes panel. */
export const OPEN_NOTES_EVENT = "zango:open-notes";
/** Fired with { detail: number } whenever the count of due reminders changes. */
export const NOTES_DUE_COUNT_EVENT = "zango:notes-due-count";

export function openStaffNotes() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_NOTES_EVENT));
  }
}

const PRIORITY_META: Record<StaffNotePriority, { label: string; dot: string; chip: string }> = {
  normal: { label: "Normal", dot: "bg-[#8A7A6D]", chip: "bg-[#FAF6F1] text-[#6B4838] border-[#E8DDD0]" },
  important: { label: "Important", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  urgent: { label: "Urgent", dot: "bg-[#C73E1D]", chip: "bg-red-50 text-[#C73E1D] border-red-200" },
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

const toLocalInputValue = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromLocalInputValue = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const formatReminder = (iso: string, now: Date) => {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Aujourd'hui ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Demain ${time}`;
  return `${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} ${time}`;
};

const isDue = (note: StaffNote, now: Date) =>
  Boolean(note.reminderAt) && !note.reminderDone && !note.done && new Date(note.reminderAt as string) <= now;

export default function GlobalNotesAccess() {
  const pathname = usePathname();
  const { showToast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState<StaffNote[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"actives" | "terminees">("actives");
  const [now, setNow] = useState(() => new Date());
  const [isSaving, setIsSaving] = useState(false);

  // Composer
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<StaffNotePriority>("normal");
  const [reminderInput, setReminderInput] = useState("");
  const [linkToPage, setLinkToPage] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  const loadNotes = useCallback(async () => {
    try {
      setLoadError("");
      const data = await getMyStaffNotes();
      setNotes(data);
      setIsLoaded(true);
    } catch (err: any) {
      setLoadError(err?.message || "Notes indisponibles.");
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Horloge des rappels (30s) + toast quand un rappel arrive à échéance
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Quand un rappel arrive à échéance : alerte plein écran + notification navigateur
  const [alertIds, setAlertIds] = useState<string[]>([]);
  useEffect(() => {
    const fresh = notes.filter((note) => isDue(note, now) && !notifiedIdsRef.current.has(note.id));
    if (!fresh.length) return;
    fresh.forEach((note) => {
      notifiedIdsRef.current.add(note.id);
      showBrowserNotification("⏰ Rappel ZangoChap", note.text.slice(0, 140));
    });
    setAlertIds((prev) => [...prev, ...fresh.map((n) => n.id).filter((id) => !prev.includes(id))]);
  }, [notes, now]);

  // Première note de la file encore due (acquittée/snoozée => passe à la suivante)
  const activeAlertNote = useMemo(() => {
    for (const id of alertIds) {
      const note = notes.find((n) => n.id === id);
      if (note && isDue(note, now)) return note;
    }
    return null;
  }, [alertIds, notes, now]);

  const dismissAlert = useCallback((id: string) => {
    setAlertIds((prev) => prev.filter((alertId) => alertId !== id));
  }, []);

  // Sonnerie forte, répétée toutes les 5s tant que l'alerte est affichée (max 6 sonneries)
  useEffect(() => {
    if (!activeAlertNote) return;
    let rings = 1;
    playReminderAlarmSound();
    const interval = window.setInterval(() => {
      rings += 1;
      if (rings > 6) {
        window.clearInterval(interval);
        return;
      }
      playReminderAlarmSound();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [activeAlertNote?.id]);

  // Ouverture globale : évènement + raccourci Alt+N
  useEffect(() => {
    const openPanel = () => setIsOpen(true);
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== "n" || isEditableTarget(event.target)) return;
      event.preventDefault();
      setIsOpen(true);
    };
    window.addEventListener(OPEN_NOTES_EVENT, openPanel);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener(OPEN_NOTES_EVENT, openPanel);
      window.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const resetComposer = () => {
    setText("");
    setPriority("normal");
    setReminderInput("");
    setLinkToPage(false);
    setEditingId(null);
  };

  const startEdit = (note: StaffNote) => {
    setEditingId(note.id);
    setText(note.text);
    setPriority(note.priority);
    setReminderInput(toLocalInputValue(note.reminderAt));
    setLinkToPage(Boolean(note.contextUrl));
    textRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (!text.trim()) {
      showToast("Écris une note d'abord", "error");
      return;
    }
    setIsSaving(true);
    try {
      const result = await upsertMyStaffNote({
        id: editingId || undefined,
        text: text.trim(),
        priority,
        reminderAt: fromLocalInputValue(reminderInput),
        contextUrl: linkToPage ? pathname : null,
        contextLabel: linkToPage ? document.title.replace(/\s*[|·-]\s*Zangochap.*$/i, "").trim() || pathname : null,
      });
      setNotes(result.notes);
      notifiedIdsRef.current.delete(result.note.id);
      resetComposer();
      showToast(editingId ? "Note mise à jour ✓" : "Note ajoutée ✓", "success");
    } catch (err: any) {
      showToast(err?.message || "Erreur lors de l'enregistrement", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const applyPatch = async (id: string, patch: Parameters<typeof patchMyStaffNote>[1], successMsg?: string) => {
    try {
      const result = await patchMyStaffNote(id, patch);
      setNotes(result.notes);
      if (patch.reminderAt) notifiedIdsRef.current.delete(id);
      if (successMsg) showToast(successMsg, "success");
    } catch (err: any) {
      showToast(err?.message || "Erreur", "error");
    }
  };

  const handleDelete = async (note: StaffNote) => {
    if (!window.confirm("Supprimer cette note ?")) return;
    try {
      const result = await deleteMyStaffNote(note.id);
      setNotes(result.notes);
      if (editingId === note.id) resetComposer();
      showToast("Note supprimée", "success");
    } catch (err: any) {
      showToast(err?.message || "Erreur", "error");
    }
  };

  const snooze = (note: StaffNote, minutes: number | "tomorrow") => {
    const next = new Date();
    if (minutes === "tomorrow") {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    } else {
      next.setMinutes(next.getMinutes() + minutes);
    }
    applyPatch(note.id, { reminderAt: next.toISOString() }, `Rappel reporté à ${formatReminder(next.toISOString(), new Date())}`);
  };

  const { activeNotes, doneNotes, dueCount } = useMemo(() => {
    const active = notes.filter((n) => !n.done);
    const done = notes.filter((n) => n.done);
    const reminderTime = (n: StaffNote) => (n.reminderAt && !n.reminderDone ? new Date(n.reminderAt).getTime() : Infinity);
    active.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const dueA = isDue(a, now) ? 0 : 1;
      const dueB = isDue(b, now) ? 0 : 1;
      if (dueA !== dueB) return dueA - dueB;
      const remA = reminderTime(a);
      const remB = reminderTime(b);
      if (remA !== remB) return remA - remB;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    done.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { activeNotes: active, doneNotes: done, dueCount: notes.filter((n) => isDue(n, now)).length };
  }, [notes, now]);

  const list = tab === "actives" ? activeNotes : doneNotes;

  // Publie le compteur de rappels dus pour le badge du header (Sidebar)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(NOTES_DUE_COUNT_EVENT, { detail: dueCount }));
  }, [dueCount]);

  return (
    <>
      {/* Alerte plein écran quand un rappel sonne */}
      <AnimatePresence>
        {activeAlertNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-[#1A1410]/95 px-4 py-6"
            role="alertdialog"
            aria-modal="true"
            aria-label="Rappel de note"
          >
            <div className="absolute inset-x-0 top-0 h-2 bg-[#D4541C]" />
            <motion.div
              initial={{ scale: 0.92, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", damping: 18, stiffness: 200 }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
            >
              {/* En-tête alarme */}
              <div className="bg-[#D4541C] px-6 py-5 flex items-center gap-4">
                <motion.div
                  animate={{ rotate: [0, -14, 14, -14, 14, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8, repeatDelay: 0.6 }}
                  className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-white shrink-0 shadow-[0_0_0_8px_rgba(255,255,255,0.08)]"
                >
                  <Bell size={30} />
                </motion.div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/80">Rappel · Call center</p>
                  <p className="text-white font-black text-[22px] leading-tight">C'est l'heure ! ⏰</p>
                </div>
              </div>

              {/* Contenu */}
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider",
                    PRIORITY_META[activeAlertNote.priority].chip,
                  )}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", PRIORITY_META[activeAlertNote.priority].dot)} />
                    {PRIORITY_META[activeAlertNote.priority].label}
                  </span>
                  {activeAlertNote.reminderAt && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#C73E1D] text-white text-[10px] font-black">
                      <AlarmClock size={11} />
                      Prévu : {formatReminder(activeAlertNote.reminderAt, now)}
                    </span>
                  )}
                </div>

                <p className="text-[20px] font-black leading-snug text-[#1A1410] whitespace-pre-wrap break-words max-h-[38dvh] overflow-y-auto">
                  {activeAlertNote.text}
                </p>

                {activeAlertNote.contextUrl && (
                  <Link
                    href={activeAlertNote.contextUrl}
                    onClick={() => dismissAlert(activeAlertNote.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4541C]/5 border border-[#D4541C]/25 text-[12px] font-bold text-[#D4541C] hover:bg-[#D4541C]/10 transition-colors max-w-full"
                  >
                    <LinkIcon size={13} className="shrink-0" />
                    <span className="truncate">{activeAlertNote.contextLabel || "Ouvrir la page liée"}</span>
                  </Link>
                )}
              </div>

              {/* Actions */}
              <div className="px-6 pb-6 space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    applyPatch(activeAlertNote.id, { reminderDone: true }, "Rappel acquitté ✓");
                    dismissAlert(activeAlertNote.id);
                  }}
                  className="w-full py-3.5 bg-[#D4541C] hover:bg-[#B8451A] text-white rounded-xl text-[14px] font-black flex items-center justify-center gap-2 transition-colors shadow-lg shadow-orange-500/25"
                >
                  <Check size={17} /> OK, j'ai vu
                </button>
                <div className="grid grid-cols-3 gap-2">
                  {([["+30 min", 30], ["+1 h", 60], ["Demain 9h", "tomorrow"]] as const).map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        snooze(activeAlertNote, value as number | "tomorrow");
                        dismissAlert(activeAlertNote.id);
                      }}
                      className="py-2.5 rounded-xl border border-[#E8DDD0] bg-[#FDFCFB] text-[12px] font-bold text-[#6B4838] hover:border-[#D4541C] hover:text-[#D4541C] transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      dismissAlert(activeAlertNote.id);
                      setIsOpen(true);
                    }}
                    className="text-[12px] font-bold text-[#8A7A6D] hover:text-[#D4541C] transition-colors"
                  >
                    Voir mes notes
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissAlert(activeAlertNote.id)}
                    className="text-[12px] font-bold text-[#8A7A6D] hover:text-[#1A1410] transition-colors"
                  >
                    Plus tard
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tiroir latéral */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] border-none cursor-default"
              aria-label="Fermer les notes"
            />
            <motion.div
              initial={{ x: "105%" }}
              animate={{ x: 0 }}
              exit={{ x: "105%" }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="fixed top-0 right-0 bottom-0 z-[81] w-[min(410px,100vw)] bg-white border-l border-[#E8DDD0] shadow-2xl shadow-black/20 flex flex-col overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Notes et rappels"
            >
            {/* Header */}
            <div className="px-5 py-4 bg-[#1A1410] text-white flex items-center justify-between shrink-0">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#E89B6F]">Call center</div>
                <div className="font-bold text-[15px] flex items-center gap-2">
                  Notes & Rappels
                  {dueCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-[#C73E1D] text-[10px] font-black">
                      {dueCount} en attente
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={loadNotes} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Actualiser">
                  <RefreshCcw size={15} />
                </button>
                <button type="button" onClick={() => setIsOpen(false)} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Fermer (Échap)">
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* Composer */}
            <div className="p-4 border-b border-[#F8F5F2] bg-[#FDFCFB] shrink-0 space-y-3">
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Ex: Rappeler Mme Koné pour confirmer la livraison…"
                rows={2}
                className="w-full bg-white border border-[#E8DDD0] rounded-lg p-3 text-sm font-medium resize-none focus:ring-2 focus:ring-[#D4541C]/10 focus:border-[#D4541C] outline-none transition-all"
              />
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(PRIORITY_META) as StaffNotePriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                      priority === p ? PRIORITY_META[p].chip + " ring-2 ring-[#D4541C]/15" : "bg-white text-[#8A7A6D] border-[#E8DDD0] hover:border-[#D4541C]/40",
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", PRIORITY_META[p].dot)} />
                    {PRIORITY_META[p].label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[170px]">
                  <AlarmClock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A7A6D] pointer-events-none" />
                  <input
                    type="datetime-local"
                    value={reminderInput}
                    onChange={(e) => setReminderInput(e.target.value)}
                    className="w-full bg-white border border-[#E8DDD0] rounded-lg py-2 pl-8 pr-2 text-[12px] font-semibold outline-none focus:border-[#D4541C] transition-colors"
                    title="Programmer un rappel"
                  />
                </div>
                <label className={cn(
                  "flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors",
                  linkToPage ? "border-[#D4541C]/40 bg-[#D4541C]/5 text-[#D4541C]" : "border-[#E8DDD0] bg-white text-[#6B4838] hover:border-[#D4541C]/30",
                )}>
                  <input
                    type="checkbox"
                    checked={linkToPage}
                    onChange={(e) => setLinkToPage(e.target.checked)}
                    className="hidden"
                  />
                  <LinkIcon size={13} /> Lier à cette page
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSaving}
                  className="flex-1 px-4 py-2.5 bg-[#D4541C] hover:bg-[#B8451A] disabled:opacity-60 text-white rounded-lg text-[12px] font-bold flex items-center justify-center gap-2 transition-colors shadow-sm shadow-orange-500/20"
                >
                  {isSaving ? <RefreshCcw size={14} className="animate-spin" /> : editingId ? <Check size={14} /> : <Plus size={14} />}
                  {editingId ? "Mettre à jour" : "Ajouter la note"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetComposer}
                    className="px-3 py-2.5 rounded-lg border border-[#E8DDD0] text-[12px] font-bold text-[#6B4838] hover:bg-[#FAF6F1] transition-colors"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="px-4 pt-3 flex items-center gap-2 shrink-0">
              {([["actives", `Actives (${activeNotes.length})`], ["terminees", `Terminées (${doneNotes.length})`]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors",
                    tab === key ? "bg-[#1A1410] text-white" : "text-[#8A7A6D] hover:bg-[#FAF6F1]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Liste */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {!isLoaded && !loadError && (
                <div className="py-10 text-center text-[12px] font-semibold text-[#8A7A6D]">Chargement…</div>
              )}
              {loadError && (
                <div className="py-8 text-center space-y-2">
                  <p className="text-[12px] font-semibold text-[#C73E1D]">{loadError}</p>
                  <button type="button" onClick={loadNotes} className="text-[12px] font-bold text-[#D4541C] hover:underline">Réessayer</button>
                </div>
              )}
              {isLoaded && list.length === 0 && (
                <div className="py-10 text-center">
                  <StickyNote size={28} className="mx-auto text-[#C8B8AA]" />
                  <p className="mt-2 text-[12px] font-semibold text-[#8A7A6D]">
                    {tab === "actives" ? "Aucune note active. Ajoute ton premier rappel 👆" : "Aucune note terminée."}
                  </p>
                </div>
              )}

              {list.map((note) => {
                const due = isDue(note, now);
                return (
                  <div
                    key={note.id}
                    className={cn(
                      "group relative rounded-xl border bg-white p-3 transition-all",
                      due ? "border-[#C73E1D]/40 bg-red-50/40 shadow-sm" : "border-[#E8DDD0] hover:border-[#D4541C]/30",
                      note.done && "opacity-60",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => applyPatch(note.id, { done: !note.done }, note.done ? undefined : "Note terminée ✓")}
                        className={cn(
                          "mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                          note.done ? "bg-green-500 border-green-500 text-white" : "border-[#C8B8AA] hover:border-[#D4541C]",
                        )}
                        title={note.done ? "Réactiver" : "Marquer terminé"}
                      >
                        {note.done && <Check size={13} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", PRIORITY_META[note.priority].dot)} title={PRIORITY_META[note.priority].label} />
                          {note.pinned && <Pin size={11} className="text-[#D4541C] shrink-0" />}
                          <p className={cn("text-[13px] font-semibold text-[#1A1410] break-words whitespace-pre-wrap", note.done && "line-through")}>
                            {note.text}
                          </p>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          {note.reminderAt && !note.done && (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black",
                              due ? "bg-[#C73E1D] border-[#C73E1D] text-white" : note.reminderDone ? "bg-[#FAF6F1] border-[#E8DDD0] text-[#8A7A6D]" : "bg-white border-[#E8DDD0] text-[#6B4838]",
                            )}>
                              {due ? <Bell size={10} /> : note.reminderDone ? <BellOff size={10} /> : <AlarmClock size={10} />}
                              {due ? "En retard · " : ""}{formatReminder(note.reminderAt, now)}
                            </span>
                          )}
                          {note.contextUrl && (
                            <Link
                              href={note.contextUrl}
                              onClick={() => setIsOpen(false)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#D4541C]/5 border border-[#D4541C]/20 text-[10px] font-bold text-[#D4541C] hover:bg-[#D4541C]/10 transition-colors max-w-[180px]"
                              title={note.contextUrl}
                            >
                              <LinkIcon size={10} className="shrink-0" />
                              <span className="truncate">{note.contextLabel || "Voir la page"}</span>
                            </Link>
                          )}
                        </div>

                        {/* Actions snooze quand le rappel est dû */}
                        {due && (
                          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            <button type="button" onClick={() => applyPatch(note.id, { reminderDone: true }, "Rappel acquitté")} className="px-2 py-1 rounded-md bg-[#1A1410] text-white text-[10px] font-black hover:bg-[#D4541C] transition-colors">
                              OK vu
                            </button>
                            <button type="button" onClick={() => snooze(note, 30)} className="px-2 py-1 rounded-md border border-[#E8DDD0] bg-white text-[10px] font-bold text-[#6B4838] hover:border-[#D4541C] transition-colors">
                              +30 min
                            </button>
                            <button type="button" onClick={() => snooze(note, 60)} className="px-2 py-1 rounded-md border border-[#E8DDD0] bg-white text-[10px] font-bold text-[#6B4838] hover:border-[#D4541C] transition-colors">
                              +1 h
                            </button>
                            <button type="button" onClick={() => snooze(note, "tomorrow")} className="px-2 py-1 rounded-md border border-[#E8DDD0] bg-white text-[10px] font-bold text-[#6B4838] hover:border-[#D4541C] transition-colors">
                              Demain 9h
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Actions au survol */}
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => applyPatch(note.id, { pinned: !note.pinned })}
                          className="p-1.5 rounded-md text-[#8A7A6D] hover:bg-[#FAF6F1] hover:text-[#D4541C] transition-colors"
                          title={note.pinned ? "Désépingler" : "Épingler"}
                        >
                          {note.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          className="p-1.5 rounded-md text-[#8A7A6D] hover:bg-[#FAF6F1] hover:text-[#D4541C] transition-colors"
                          title="Modifier"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(note)}
                          className="p-1.5 rounded-md text-[#8A7A6D] hover:bg-red-50 hover:text-[#C73E1D] transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-[#F8F5F2] bg-[#FDFCFB] text-[10px] font-semibold text-[#8A7A6D] flex items-center justify-between shrink-0">
              <span>Raccourci : Alt+N · Ctrl+Entrée pour enregistrer</span>
              <span>Notes privées</span>
            </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
