export type StaffNotePriority = "normal" | "important" | "urgent";

export type StaffNote = {
  id: string;
  text: string;
  priority: StaffNotePriority;
  /** ISO date du rappel, null si pas de rappel */
  reminderAt: string | null;
  /** Rappel acquitté (vu / snoozé traité) */
  reminderDone: boolean;
  done: boolean;
  pinned: boolean;
  /** Lien optionnel vers la page liée (ex: fiche commande) */
  contextUrl: string | null;
  contextLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

export const STAFF_NOTE_PRIORITIES: StaffNotePriority[] = ["normal", "important", "urgent"];

/** Limite le poids du JSON stocké en CmsContent */
export const MAX_STAFF_NOTES = 200;

const toIsoOrNull = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function normalizeStaffNote(raw: any): StaffNote | null {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id || !text) return null;

  const priority: StaffNotePriority = STAFF_NOTE_PRIORITIES.includes(raw.priority)
    ? raw.priority
    : "normal";

  const now = new Date().toISOString();
  return {
    id,
    text: text.slice(0, 2000),
    priority,
    reminderAt: toIsoOrNull(raw.reminderAt),
    reminderDone: Boolean(raw.reminderDone),
    done: Boolean(raw.done),
    pinned: Boolean(raw.pinned),
    contextUrl: typeof raw.contextUrl === "string" && raw.contextUrl.startsWith("/") ? raw.contextUrl.slice(0, 500) : null,
    contextLabel: typeof raw.contextLabel === "string" ? raw.contextLabel.slice(0, 120) : null,
    createdAt: toIsoOrNull(raw.createdAt) || now,
    updatedAt: toIsoOrNull(raw.updatedAt) || now,
  };
}

export function normalizeStaffNotes(data: unknown): StaffNote[] {
  if (!Array.isArray(data)) return [];
  return data
    .map(normalizeStaffNote)
    .filter((note): note is StaffNote => note !== null)
    .slice(0, MAX_STAFF_NOTES);
}
