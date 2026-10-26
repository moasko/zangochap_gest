// Actions de l'application livreur : delegue aux actions metier existantes (memes regles,
// memes droits, meme historique que l'espace web /zangochap-rider) avec la session du jeton.
import { z } from "zod";

import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import { sendOrderSupportAlert } from "@/modules/chat/actions";
import { MobileApiError } from "@/modules/mobile-api/errors";
import { markPartialDelivery, updateOrderStatus } from "@/modules/orders/actions";

export async function requireRider() {
  const session = await getSession();
  if (!session) throw new MobileApiError("Session expiree. Reconnectez-vous.", 401, "UNAUTHENTICATED");
  if (session.role !== "livreur") throw new MobileApiError("Application reservee aux livreurs.", 403, "NOT_A_RIDER");
  return session;
}

export const statusSchema = z.object({
  status: z.enum(["DELIVERED", "RETURNED", "REPRO_DISPO"]),
  reason: z.string().trim().max(500).optional(),
  amountReceived: z.number().int().min(0).max(100_000_000).nullable().optional(),
  // Reprogrammation : nouvelle date souhaitee (AAAA-MM-JJ).
  reproDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const partialSchema = z.object({
  deliveredQuantities: z.record(z.string(), z.number().int().min(0).max(1000)),
  note: z.string().trim().max(500).optional(),
  includeDeliveryFee: z.boolean().default(true),
  amountReceived: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

export const alertSchema = z.object({ reason: z.string().trim().min(1).max(120), details: z.string().trim().max(500).optional() });

const CLOSED = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"];

/**
 * Action rejouee depuis la file hors ligne : si la commande est deja dans l'etat vise
 * par ce livreur, on renvoie un succes au lieu d'une erreur « deja cloturee ».
 */
async function alreadyApplied(orderId: string, riderId: string, target: string[]) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, deliverymanId: true, lastDeliveryAttemptRiderId: true } });
  return Boolean(order && target.includes(order.status) && (order.deliverymanId === riderId || order.lastDeliveryAttemptRiderId === riderId));
}

function rethrow(error: unknown): never {
  if (error instanceof MobileApiError) throw error;
  const message = error instanceof Error ? error.message : "Action impossible.";
  throw new MobileApiError(message, 422, "REJECTED");
}

export async function setMissionStatus(orderId: string, input: z.infer<typeof statusSchema>) {
  const rider = await requireRider();
  if (await alreadyApplied(orderId, rider.id, [input.status])) return { ok: true, replayed: true };
  if (input.status !== "DELIVERED" && !input.reason) throw new MobileApiError("Indiquez le motif.", 400, "REASON_REQUIRED");
  try {
    await updateOrderStatus(orderId, input.status, input.reason, input.amountReceived ?? null, input.reproDate);
    return { ok: true, replayed: false };
  } catch (error) {
    rethrow(error);
  }
}

export async function setPartialDelivery(orderId: string, input: z.infer<typeof partialSchema>) {
  const rider = await requireRider();
  if (await alreadyApplied(orderId, rider.id, ["PARTIALLY_DELIVERED"])) return { ok: true, replayed: true };
  try {
    await markPartialDelivery(orderId, input.deliveredQuantities, input.note, input.includeDeliveryFee, input.amountReceived ?? null);
    return { ok: true, replayed: false };
  } catch (error) {
    rethrow(error);
  }
}

export async function sendMissionAlert(orderId: string, input: z.infer<typeof alertSchema>) {
  await requireRider();
  try {
    return await sendOrderSupportAlert({ orderId, reason: input.reason, details: input.details });
  } catch (error) {
    rethrow(error);
  }
}

export { CLOSED as CLOSED_STATUSES };
