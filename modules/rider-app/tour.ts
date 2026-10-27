// Suivi de tournee de l'application livreur : traces dans l'historique de la commande
// (« en route », appels sans reponse) et cloture de caisse du soir envoyee au bureau.
// Stockage CmsContent / ChatMessage existants : aucune migration.
import { z } from "zod";

import prisma from "@/lib/prisma";
import { MobileApiError } from "@/modules/mobile-api/errors";

type Rider = { id: string; email: string; name: string };

// ---------- Traces de tournee ----------

export const noteSchema = z.object({
  kind: z.enum(["en_route", "call_no_answer"]),
  // Nombre d'appels sans reponse (call_no_answer).
  calls: z.number().int().min(1).max(50).optional(),
  at: z.string().datetime().optional(),
});

const NOTE_LABELS = {
  en_route: "Livreur en route : client prevenu sur WhatsApp",
  call_no_answer: "Client injoignable",
} as const;

export async function addMissionNote(rider: Rider, orderId: string, input: z.infer<typeof noteSchema>) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, deliverymanId: true, history: true, deletedAt: true } });
  if (!order || order.deletedAt) throw new MobileApiError("Commande introuvable.", 404, "NOT_FOUND");
  if (order.deliverymanId !== rider.id) throw new MobileApiError("Cette commande ne vous est pas attribuee.", 403, "FORBIDDEN");
  const at = input.at ?? new Date().toISOString();
  const history = Array.isArray(order.history) ? [...(order.history as Record<string, unknown>[])] : [];
  // Rejeu hors ligne : meme trace au meme instant = deja enregistree.
  if (history.some((entry) => entry.at === at && entry.riderNote === input.kind)) return { ok: true, replayed: true };
  const label = input.kind === "call_no_answer" && input.calls ? `${NOTE_LABELS.call_no_answer} (${input.calls} appel(s) sans reponse)` : NOTE_LABELS[input.kind];
  history.push({ at, action: label, by: rider.email, byName: rider.name, riderNote: input.kind });
  await prisma.order.update({ where: { id: order.id }, data: { history: history as object[] } });
  return { ok: true, replayed: false };
}

// ---------- Cloture de caisse ----------

const PAID = ["DELIVERED", "PARTIALLY_DELIVERED"] as const;
const ISSUES = ["RETURNED", "CANCELLED", "REPRO_DISPO"] as const;

export const cashDaySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const cashReportSchema = cashDaySchema.extend({ note: z.string().trim().max(500).optional() });

function collected(order: { amountReceived: number | null; total: number; deliveryFee: number; discount: number }) {
  return order.amountReceived !== null && order.amountReceived !== undefined
    ? Math.max(0, order.amountReceived)
    : Math.max(0, order.total + order.deliveryFee - (order.discount || 0));
}

/** Recapitulatif calcule cote serveur (jamais sur la foi du telephone). Journee en heure d'Abidjan (UTC). */
export async function cashSummary(rider: Rider, date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  if (!Number.isFinite(start.getTime())) throw new MobileApiError("Date invalide.", 400, "INVALID_DATE");

  const [delivered, issues, unsettled, existing] = await Promise.all([
    prisma.order.findMany({
      where: { deletedAt: null, deliverymanId: rider.id, status: { in: [...PAID] }, deliveredAt: { gte: start.toISOString(), lt: end.toISOString() } },
      select: { id: true, ref: true, customerName: true, status: true, total: true, deliveryFee: true, discount: true, amountReceived: true, settlementId: true },
    }),
    prisma.order.findMany({
      where: { deletedAt: null, lastDeliveryAttemptRiderId: rider.id, status: { in: [...ISSUES] }, lastDeliveryAttemptAt: { gte: start, lt: end } },
      select: { id: true, ref: true, customerName: true, status: true, returnReason: true },
    }),
    prisma.order.findMany({
      where: { deletedAt: null, deliverymanId: rider.id, status: { in: [...PAID] }, settlementId: null },
      select: { total: true, deliveryFee: true, discount: true, amountReceived: true },
    }),
    prisma.cmsContent.findUnique({ where: { key: `rider-cash-report:${rider.id}:${date}` } }),
  ]);

  const dayTotal = delivered.reduce((sum, order) => sum + collected(order), 0);
  const dayFees = delivered.reduce((sum, order) => sum + Math.min(Math.max(0, order.deliveryFee), collected(order)), 0);
  const toSettle = unsettled.reduce((sum, order) => sum + collected(order), 0);
  return {
    date,
    delivered: delivered.filter((order) => order.status === "DELIVERED").length,
    partial: delivered.filter((order) => order.status === "PARTIALLY_DELIVERED").length,
    returned: issues.filter((order) => order.status !== "REPRO_DISPO").length,
    rescheduled: issues.filter((order) => order.status === "REPRO_DISPO").length,
    dayTotal,
    dayItems: dayTotal - dayFees,
    dayFees,
    toSettle,
    orders: delivered.map((order) => ({ id: order.id, ref: order.ref || order.id, customerName: order.customerName, status: order.status, amount: collected(order), settled: Boolean(order.settlementId) })),
    returns: issues.map((order) => ({ id: order.id, ref: order.ref || order.id, customerName: order.customerName, status: order.status, reason: order.returnReason })),
    submittedAt: (existing?.data as { submittedAt?: string } | undefined)?.submittedAt ?? null,
  };
}

const formatPrice = (value: number) => `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} F`;

/** Envoie la cloture au bureau (messagerie ADMIN et COMPTABLE) et la conserve. Une seule par jour. */
export async function submitCashReport(rider: Rider, input: z.infer<typeof cashReportSchema>) {
  const summary = await cashSummary(rider, input.date);
  if (summary.submittedAt) return { ...summary, alreadySubmitted: true };
  const submittedAt = new Date().toISOString();
  const day = new Date(`${input.date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const body = [
    `[CAISSE LIVREUR] ${rider.name} · ${day}`,
    `Livrees : ${summary.delivered} · Partielles : ${summary.partial} · Retours : ${summary.returned} · Reportees : ${summary.rescheduled}`,
    `Encaisse du jour : ${formatPrice(summary.dayTotal)} (articles ${formatPrice(summary.dayItems)} + frais ${formatPrice(summary.dayFees)})`,
    `Total a regulariser (toutes dates) : ${formatPrice(summary.toSettle)}`,
    ...(summary.returns.length ? [`Colis a rapporter : ${summary.returns.filter((order) => order.status !== "REPRO_DISPO").map((order) => order.ref).join(", ") || "aucun"}`] : []),
    ...(input.note ? [`Note du livreur : ${input.note}`] : []),
  ].join("\n");

  await prisma.$transaction([
    prisma.cmsContent.create({
      data: { key: `rider-cash-report:${rider.id}:${input.date}`, updatedBy: rider.email, data: { ...summary, submittedAt, note: input.note ?? null, riderId: rider.id, riderName: rider.name } },
    }),
    ...(["ADMIN", "COMPTABLE"] as const).map((role) =>
      prisma.chatMessage.create({ data: { body, scope: "ROLE", targetRole: role, senderId: rider.id, senderName: rider.name, senderRole: "LIVREUR", reads: { create: { userId: rider.id } } } }),
    ),
  ]);
  return { ...summary, submittedAt, alreadySubmitted: false };
}
