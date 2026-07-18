"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  MAX_STAFF_NOTES,
  normalizeStaffNote,
  normalizeStaffNotes,
  StaffNote,
  StaffNotePriority,
} from "./types";

const NOTES_ROLES = ["admin", "commercial"];
const notesKey = (userId: string) => `staff-notes:${userId}`;

async function readNotes(userId: string): Promise<StaffNote[]> {
  const row = await prisma.cmsContent.findUnique({
    where: { key: notesKey(userId) },
    select: { data: true },
  });
  return normalizeStaffNotes(row?.data);
}

async function writeNotes(userId: string, email: string, notes: StaffNote[]) {
  const clean = normalizeStaffNotes(notes);
  await prisma.cmsContent.upsert({
    where: { key: notesKey(userId) },
    update: { data: clean as any, updatedBy: email },
    create: { key: notesKey(userId), data: clean as any, updatedBy: email },
  });
  return clean;
}

export async function getMyStaffNotes(): Promise<StaffNote[]> {
  const session = await ensureAuth(NOTES_ROLES);
  return readNotes(session.id);
}

export async function upsertMyStaffNote(input: {
  id?: string;
  text: string;
  priority?: StaffNotePriority;
  reminderAt?: string | null;
  pinned?: boolean;
  contextUrl?: string | null;
  contextLabel?: string | null;
}): Promise<{ success: true; note: StaffNote; notes: StaffNote[] }> {
  const session = await ensureAuth(NOTES_ROLES);
  const text = (input.text || "").trim();
  if (!text) throw new Error("La note ne peut pas être vide.");

  const notes = await readNotes(session.id);
  const now = new Date().toISOString();
  const existing = input.id ? notes.find((n) => n.id === input.id) : undefined;

  const note = normalizeStaffNote({
    ...(existing || {
      id: randomUUID(),
      done: false,
      pinned: false,
      createdAt: now,
    }),
    text,
    priority: input.priority ?? existing?.priority ?? "normal",
    reminderAt: input.reminderAt === undefined ? existing?.reminderAt ?? null : input.reminderAt,
    // Un nouveau rappel repart non-acquitté
    reminderDone: input.reminderAt !== undefined && input.reminderAt !== existing?.reminderAt
      ? false
      : existing?.reminderDone ?? false,
    pinned: input.pinned ?? existing?.pinned ?? false,
    contextUrl: input.contextUrl === undefined ? existing?.contextUrl ?? null : input.contextUrl,
    contextLabel: input.contextLabel === undefined ? existing?.contextLabel ?? null : input.contextLabel,
    updatedAt: now,
  });
  if (!note) throw new Error("Note invalide.");

  const next = existing
    ? notes.map((n) => (n.id === note.id ? note : n))
    : [note, ...notes];

  if (next.length > MAX_STAFF_NOTES) {
    throw new Error(`Limite de ${MAX_STAFF_NOTES} notes atteinte. Supprime des notes terminées.`);
  }

  const saved = await writeNotes(session.id, session.email, next);
  return { success: true, note, notes: saved };
}

export async function patchMyStaffNote(id: string, patch: {
  done?: boolean;
  pinned?: boolean;
  reminderDone?: boolean;
  reminderAt?: string | null;
}): Promise<{ success: true; notes: StaffNote[] }> {
  const session = await ensureAuth(NOTES_ROLES);
  const notes = await readNotes(session.id);
  const target = notes.find((n) => n.id === id);
  if (!target) throw new Error("Note introuvable.");

  const now = new Date().toISOString();
  const next = notes.map((n) => {
    if (n.id !== id) return n;
    const updated: StaffNote = { ...n, updatedAt: now };
    if (patch.done !== undefined) {
      updated.done = patch.done;
      // Marquer terminé acquitte aussi le rappel
      if (patch.done) updated.reminderDone = true;
    }
    if (patch.pinned !== undefined) updated.pinned = patch.pinned;
    if (patch.reminderDone !== undefined) updated.reminderDone = patch.reminderDone;
    if (patch.reminderAt !== undefined) {
      updated.reminderAt = patch.reminderAt;
      // Nouveau rappel (snooze) => non-acquitté
      if (patch.reminderAt) updated.reminderDone = false;
    }
    return updated;
  });

  const saved = await writeNotes(session.id, session.email, next);
  return { success: true, notes: saved };
}

export async function deleteMyStaffNote(id: string): Promise<{ success: true; notes: StaffNote[] }> {
  const session = await ensureAuth(NOTES_ROLES);
  const notes = await readNotes(session.id);
  const saved = await writeNotes(session.id, session.email, notes.filter((n) => n.id !== id));
  return { success: true, notes: saved };
}
