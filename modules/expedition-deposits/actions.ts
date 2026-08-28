"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import { revalidatePath } from "next/cache";

const ADMIN_ROLES = new Set(["ADMIN", "DEVELOPER"]);
const REVIEW_STATUSES = new Set(["RECEIVED", "NOT_RECEIVED", "CORRECTION_REQUIRED"]);

function cleanPhone(value: string) {
  return value.replace(/\D/g, "");
}

export async function getDepositAdminData() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.has(String(session.role).toUpperCase())) throw new Error("Accès refusé");

  return prisma.order.findMany({
    where: { deletedAt: null, commune: { equals: "Hors Abidjan", mode: "insensitive" }, depositVerificationStatus: { not: null } },
    select: {
      id: true, ref: true, customerName: true, customerPhone: true, total: true, deliveryFee: true,
      paymentMethod: true, depositSenderPhone: true, depositTransactionRef: true,
      depositVerificationStatus: true, depositVerificationNote: true, depositVerifiedAt: true,
      depositVerifiedByName: true, commercialName: true, createdAt: true, status: true,
    },
    orderBy: [{ depositVerificationStatus: "asc" }, { createdAt: "desc" }],
  });
}

export async function reviewExpeditionDeposit(orderId: string, status: string, note?: string) {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.has(String(session.role).toUpperCase())) throw new Error("Action réservée aux administrateurs.");
  if (!REVIEW_STATUSES.has(status)) throw new Error("Décision invalide.");
  if (status !== "RECEIVED" && !note?.trim()) throw new Error("Indiquez au commercial ce qui doit être corrigé.");

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, commune: true, history: true } });
  if (!order || order.commune?.trim().toLowerCase() !== "hors abidjan") throw new Error("Expédition introuvable.");
  const history = Array.isArray(order.history) ? [...order.history] : [];
  history.push({ at: new Date().toISOString(), action: status === "RECEIVED" ? "Dépôt expédition confirmé reçu" : `Dépôt expédition non validé : ${note?.trim()}`, by: session.email, byName: session.name });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      depositVerificationStatus: status as "RECEIVED" | "NOT_RECEIVED" | "CORRECTION_REQUIRED",
      depositVerificationNote: note?.trim() || null,
      depositVerifiedAt: new Date(),
      depositVerifiedByName: session.name,
      depositAlertAcknowledgedAt: status === "RECEIVED" ? new Date() : null,
      history,
    },
  });
  revalidatePath("/zangochap-manager/admin/expeditions/deposits");
  revalidatePath("/zangochap-manager/logistics/packing");
  return { success: true };
}

export async function getMyDepositAlerts() {
  const session = await getSession();
  if (!session || String(session.role).toUpperCase() !== "COMMERCIAL") return [];
  return prisma.order.findMany({
    where: {
      commercialId: session.id, deletedAt: null, depositAlertAcknowledgedAt: null,
      depositVerificationStatus: { in: ["NOT_RECEIVED", "CORRECTION_REQUIRED"] },
    },
    select: { id: true, ref: true, customerName: true, customerPhone: true, paymentMethod: true, depositSenderPhone: true, depositTransactionRef: true, depositVerificationStatus: true, depositVerificationNote: true, depositVerifiedAt: true },
    orderBy: { depositVerifiedAt: "asc" },
  });
}

export async function acknowledgeDepositAlert(orderId: string) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");
  const result = await prisma.order.updateMany({
    where: { id: orderId, commercialId: session.id, depositVerificationStatus: { in: ["NOT_RECEIVED", "CORRECTION_REQUIRED"] } },
    data: { depositAlertAcknowledgedAt: new Date() },
  });
  if (!result.count) throw new Error("Alerte introuvable.");
  return { success: true };
}

export async function correctExpeditionDeposit(orderId: string, senderPhone: string, transactionRef?: string) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");
  const phone = cleanPhone(senderPhone);
  if (!phone) throw new Error("Le numéro ayant effectué le dépôt est obligatoire.");
  const order = await prisma.order.findFirst({ where: { id: orderId, commercialId: session.id, deletedAt: null }, select: { history: true } });
  if (!order) throw new Error("Commande introuvable ou accès refusé.");
  const history = Array.isArray(order.history) ? [...order.history] : [];
  history.push({ at: new Date().toISOString(), action: "Informations du dépôt corrigées — nouvelle vérification demandée", by: session.email, byName: session.name });
  await prisma.order.update({ where: { id: orderId }, data: {
    depositSenderPhone: phone, depositTransactionRef: transactionRef?.trim() || null,
    depositVerificationStatus: "PENDING", depositVerificationNote: null, depositVerifiedAt: null,
    depositVerifiedByName: null, depositAlertAcknowledgedAt: new Date(), history,
  } });
  revalidatePath("/zangochap-manager/admin/expeditions/deposits");
  revalidatePath("/zangochap-manager/orders");
  return { success: true };
}
