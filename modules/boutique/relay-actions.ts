"use server";

import { revalidatePath } from "next/cache";
import { OrderStatus, Role, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";

const RELAY_PATH = "/zangochap-manager/boutique";
const RELAY_MARKER = "[POINT_RELAIS]";
const ALLOWED_DROP_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.ON_DELIVERY,
  OrderStatus.REPRO_DISPO,
  OrderStatus.COLLECTED,
] as const;
const RELAY_EXIT_OUTCOMES = [
  "Annulé par la boutique",
  "Refus client",
  "Livré autrement",
  "Retour au gestionnaire",
  "Autre issue",
] as const;

type RelaySession = {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  serviceLabel?: string | null;
};

function actorFromSession(session: RelaySession) {
  return {
    by: session.email || "system",
    byName: session.name || "Systeme",
  };
}

function getHistory(history: Prisma.JsonValue | null | undefined) {
  return Array.isArray(history) ? [...history] : [];
}

// Le marqueur relais vit sur une seule ligne parsee par regex : on neutralise
// les separateurs (| et retours ligne) dans les valeurs injectees.
function sanitizeMarkerValue(value?: string) {
  return String(value || "").replace(/[|\r\n]+/g, " ").trim();
}

function appendRelayNote(currentNote: string | null | undefined, boutiqueName: string, shelfCode?: string, note?: string) {
  const cleanCurrent = currentNote?.trim();
  const cleanShelf = sanitizeMarkerValue(shelfCode);
  const cleanNote = sanitizeMarkerValue(note);
  const relayLine = `${RELAY_MARKER} Boutique: ${sanitizeMarkerValue(boutiqueName)}${cleanShelf ? ` | Emplacement: ${cleanShelf}` : ""}${cleanNote ? ` | Note: ${cleanNote}` : ""}`;
  if (!cleanCurrent) return relayLine;
  if (cleanCurrent.includes(RELAY_MARKER)) {
    return cleanCurrent
      .split("\n")
      .map((line) => (line.includes(RELAY_MARKER) ? relayLine : line))
      .join("\n");
  }
  return `${cleanCurrent}\n${relayLine}`;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeAmount(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Montant recu invalide.");
  return Math.round(amount);
}

function getRelayAssignmentError(session: RelaySession, deliveryNote: string | null) {
  if (session.role?.toLowerCase() !== "point_relais") return null;

  const assignedRelay = normalizeText(session.serviceLabel).toLowerCase();
  if (!assignedRelay) {
    return "Aucun point relais n'est attribue a ce compte.";
  }

  const relayLine = deliveryNote
    ?.split("\n")
    .find((line) => line.includes(RELAY_MARKER));
  const boutiqueName = relayLine?.match(/Boutique:\s*([^|]+)/)?.[1]?.trim().toLowerCase();
  if (!boutiqueName || boutiqueName !== assignedRelay) {
    return "Ce colis appartient a un autre point relais.";
  }
  return null;
}

export async function depositRelayParcelAction(data: {
  orderRef: string;
  boutiqueName: string;
  shelfCode?: string;
  note?: string;
}) {
  const session = await ensureAuth(["admin", "developer", "collection"]);
  const rawRef = normalizeText(data.orderRef);
  const orderRef = rawRef.toUpperCase();
  const requestedBoutique = normalizeText(data.boutiqueName);
  const shelfCode = normalizeText(data.shelfCode);
  const note = normalizeText(data.note);

  if (!rawRef) return { success: false, error: "Reference de colis obligatoire." };
  if (!requestedBoutique) return { success: false, error: "Nom de la boutique obligatoire." };

  // Le rattachement au gerant se fait par egalite exacte sur serviceLabel :
  // on valide et canonise le nom pour eviter les colis orphelins (faute de frappe).
  const relayAccount = await prisma.user.findFirst({
    where: {
      role: Role.POINT_RELAIS,
      serviceLabel: { equals: requestedBoutique, mode: "insensitive" },
    },
    select: { serviceLabel: true },
  });
  const boutiqueName = relayAccount?.serviceLabel?.trim();
  if (!boutiqueName) {
    return { success: false, error: `Aucun point relais nomme "${requestedBoutique}". Verifiez le nom de la boutique.` };
  }

  const order = await prisma.order.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { ref: orderRef },
        { id: rawRef },
      ],
    },
    select: {
      id: true,
      ref: true,
      status: true,
      history: true,
      deliveryNote: true,
      customerName: true,
      deliverymanId: true,
      deliverymanName: true,
    },
  });

  if (!order) return { success: false, error: "Colis introuvable." };
  if (!ALLOWED_DROP_STATUSES.includes(order.status as typeof ALLOWED_DROP_STATUSES[number])) {
    return { success: false, error: `Ce colis ne peut pas etre depose en boutique depuis le statut ${order.status}.` };
  }

  const actor = actorFromSession(session);
  const history = getHistory(order.history);
  history.push({
    at: new Date().toISOString(),
    action: `Point relais : colis disponible en boutique ${boutiqueName}${shelfCode ? ` (${shelfCode})` : ""}`,
    ...actor,
  });
  if (note) {
    history.push({
      at: new Date().toISOString(),
      action: `Note boutique : ${note}`,
      ...actor,
    });
  }
  // Le depot met fin a la mission du livreur : l'encaissement se fera en boutique,
  // la commande ne doit plus entrer dans son reglement.
  if (order.deliverymanId) {
    history.push({
      at: new Date().toISOString(),
      action: `Colis remis en boutique par le livreur ${order.deliverymanName || ""} : fin de mission livraison`.trim(),
      ...actor,
    });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.COLLECTED,
      history,
      deliveryNote: appendRelayNote(order.deliveryNote, boutiqueName, shelfCode, note),
      deliveryDate: new Date(),
      deliverymanId: null,
      deliverymanName: null,
      lastDeliveryAttemptAt: new Date(),
      lastDeliveryAttemptStatus: "BOUTIQUE_AVAILABLE",
      lastDeliveryAttemptReason: note || null,
    },
    select: { id: true, ref: true, customerName: true },
  });

  revalidatePath(RELAY_PATH);
  revalidatePath("/zangochap-manager/orders");
  return { success: true, message: `Colis ${updated.ref || updated.id} disponible en boutique.`, order: updated };
}

export async function markRelayParcelPickedUpAction(data: {
  orderId: string;
  receiverName?: string;
  amountReceived?: number | string;
  note?: string;
}) {
  const session = await ensureAuth(["admin", "developer", "point_relais"]);
  const orderId = normalizeText(data.orderId);
  const receiverName = normalizeText(data.receiverName) || "Client";
  const note = normalizeText(data.note);
  const amountReceived = normalizeAmount(data.amountReceived);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, ref: true, status: true, history: true, deliveryNote: true, total: true, deliveryFee: true, discount: true },
  });

  if (!order) return { success: false, error: "Colis introuvable." };
  const assignmentError = getRelayAssignmentError(session, order.deliveryNote);
  if (assignmentError) return { success: false, error: assignmentError };
  if (order.status !== OrderStatus.COLLECTED) {
    return { success: false, error: "Ce colis n'est pas marque disponible en boutique." };
  }

  // La compta se base sur l'encaisse : jamais de livraison relais sans montant.
  // Champ vide = montant attendu ; un 0 explicite reste possible.
  const finalAmountReceived = amountReceived !== undefined
    ? amountReceived
    : Math.max(0, order.total + order.deliveryFee - (order.discount || 0));

  const actor = actorFromSession(session);
  const history = getHistory(order.history);
  history.push({
    at: new Date().toISOString(),
    action: `Point relais : colis recupere par ${receiverName}`,
    ...actor,
  });
  history.push({
    at: new Date().toISOString(),
    action: `Montant recu boutique : ${finalAmountReceived} F`,
    ...actor,
  });
  if (note) {
    history.push({
      at: new Date().toISOString(),
      action: `Note recuperation boutique : ${note}`,
      ...actor,
    });
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.DELIVERED,
      history,
      deliveredAt: new Date().toISOString(),
      amountReceived: finalAmountReceived,
      lastDeliveryAttemptAt: new Date(),
      lastDeliveryAttemptStatus: "BOUTIQUE_PICKED_UP",
      lastDeliveryAttemptReason: note || null,
    },
  });

  revalidatePath(RELAY_PATH);
  revalidatePath("/zangochap-manager/orders");
  return { success: true, message: "Recuperation client confirmee." };
}

export async function cancelRelayParcelAction(data: {
  orderId: string;
  reason: string;
  outcome?: string;
}) {
  const session = await ensureAuth(["admin", "developer", "point_relais"]);
  const orderId = normalizeText(data.orderId);
  const reason = normalizeText(data.reason);
  const outcome = normalizeText(data.outcome) || RELAY_EXIT_OUTCOMES[0];

  if (!RELAY_EXIT_OUTCOMES.includes(outcome as typeof RELAY_EXIT_OUTCOMES[number])) {
    return { success: false, error: "Issue de colis invalide." };
  }
  if (!reason) return { success: false, error: "Une précision est obligatoire pour clôturer le colis." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, ref: true, status: true, history: true, deliveryNote: true },
  });

  if (!order) return { success: false, error: "Colis introuvable." };
  const assignmentError = getRelayAssignmentError(session, order.deliveryNote);
  if (assignmentError) return { success: false, error: assignmentError };
  if (order.status !== OrderStatus.COLLECTED) {
    return { success: false, error: "Seuls les colis disponibles en boutique peuvent être clôturés ici." };
  }

  const isDeliveredElsewhere = outcome === "Livré autrement";

  const actor = actorFromSession(session);
  const history = getHistory(order.history);
  history.push({
    at: new Date().toISOString(),
    action: `Point relais : ${isDeliveredElsewhere ? "colis livré autrement" : `sortie du colis (${outcome})`}`,
    ...actor,
  });
  history.push({
    at: new Date().toISOString(),
    action: `Motif boutique : ${reason}`,
    ...actor,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: isDeliveredElsewhere ? OrderStatus.DELIVERED : OrderStatus.CANCELLED,
      history,
      returnReason: isDeliveredElsewhere ? null : `${outcome} - ${reason}`,
      deliveredAt: isDeliveredElsewhere ? new Date().toISOString() : undefined,
      lastDeliveryAttemptAt: new Date(),
      lastDeliveryAttemptStatus: isDeliveredElsewhere ? "BOUTIQUE_DELIVERED_OTHER" : "BOUTIQUE_CLOSED_OTHER",
      lastDeliveryAttemptReason: reason,
    },
  });

  revalidatePath(RELAY_PATH);
  revalidatePath("/zangochap-manager/orders");
  return {
    success: true,
    message: isDeliveredElsewhere ? "Colis confirmé comme livré autrement." : "Issue du colis enregistrée avec son motif.",
  };
}
