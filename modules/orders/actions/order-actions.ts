"use server";

import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { createOrderWithContext, type OrderCreationInput } from "./order-creation-service";
import { requestOrderExchange } from "./exchange-actions";
import { revalidatePath as nextRevalidatePath } from "next/cache";

function revalidatePath(path: string) {
  try {
    nextRevalidatePath(path);
  } catch (e) {
    // Safely ignore Next.js context errors in script/CLI environments
  }
}

import { getSession } from "@/modules/auth/actions";
import { ensureAuth } from "@/lib/auth";
import { uploadImage } from "@/lib/upload";
import { checkOrderAccess, generateUniqueRef } from "../helpers";
import { decrementStockForOrder, restoreStockForOrder } from "./stock";
import { recordDeveloperAudit } from "@/modules/developer/audit";

// ============ POINT RELAIS ============
// L'attribution relais vit sous forme d'une ligne marqueur dans deliveryNote,
// parsee par regex cote boutique. Ces helpers garantissent qu'une seule ligne
// marqueur existe et que les valeurs injectees ne cassent pas le parsing.
const RELAY_MARKER = "[POINT_RELAIS]";
const RELAY_COMMUNE = "boutique";

function sanitizeRelayMarkerValue(value?: string | null) {
  return String(value || "").replace(/[|\r\n]+/g, " ").trim();
}

function buildRelayMarkerLine(relayPointName: string, note?: string | null) {
  const cleanNote = sanitizeRelayMarkerValue(note);
  return `${RELAY_MARKER} Boutique: ${sanitizeRelayMarkerValue(relayPointName)}${cleanNote ? ` | Note: ${cleanNote}` : ""}`;
}

function getRelayMarkerLine(note?: string | null) {
  return String(note || "").split("\n").find((line) => line.includes(RELAY_MARKER)) || null;
}

function getRelayNameFromMarker(note?: string | null) {
  return getRelayMarkerLine(note)?.match(/Boutique:\s*([^|]+)/)?.[1]?.trim() || null;
}

function stripRelayMarker(note?: string | null) {
  const cleaned = String(note || "")
    .split("\n")
    .filter((line) => !line.includes(RELAY_MARKER))
    .join("\n")
    .trim();
  return cleaned || null;
}

// ============ GET ORDER ============
export async function getOrder(id: string) {
  const session = await ensureAuth();
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true }
  });
  if (order && !checkOrderAccess(order, session)) {
    throw new Error("Accès refusé à cette commande.");
  }
  return order;
}

// ============ CREATE ORDER ============
export async function createOrder(data: OrderCreationInput) {
  const session = await getSession();
  if (session?.role === "commercial" && String(data.type).trim().toLowerCase() === "echange") {
    throw new Error("L’échange nécessite une validation administrateur. Utilisez Créer un échange sur la commande originale.");
  }
  return createOrderWithContext(data, session);
}
// ============ CREATE PUBLIC ORDER (checkout site) ============
// Enveloppe le checkout public : capture l'erreur COTE SERVEUR et la renvoie comme
// donnee. Sans ca, Next.js masque en production le message des erreurs jetees par
// une Server Action (message generique + digest), et le client voyait une erreur
// opaque "Erreur lors de la commande" sans savoir quoi corriger.
export async function createPublicOrder(
  data: Omit<Parameters<typeof createOrder>[0], "source" | "status">,
) {
  try {
    const result = await createOrder({ ...data, source: "public", status: "TO_PROCESS" });
    return { success: true as const, order: result.order };
  } catch (e: any) {
    return { success: false as const, error: e?.message || "Impossible d'enregistrer la commande. Reessayez." };
  }
}

// ============ DELETE ORDER (SOFT DELETE) ============
export async function deleteOrder(orderId: string) {
  const session = await getSession();
  if (!session || !['ADMIN', 'COMMERCIAL', 'DEVELOPER'].includes(session.role?.toUpperCase())) throw new Error("Accès refusé");

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new Error("Commande introuvable");
  if (!checkOrderAccess(order, session)) throw new Error("Accès refusé");

  // Restore stock if it was already decremented
  if (order.stockDecremented) {
    await restoreStockForOrder(order, session, 'ADJUSTMENT');
  }

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: "Commande SUPPRIMÉE (Soft Delete)",
    by: session.email,
    byName: session.name
  });

  // Soft delete: Update status to CANCELLED and mark the ref
  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        deletedAt: new Date(),
        ...(order.ref
          ? { ref: order.ref.startsWith('[SUPPRIMÉ]') ? order.ref : `[SUPPRIMÉ] ${order.ref}` }
          : {}),
        history,
        stockDecremented: false,
      },
    }),
    prisma.giftApprovalRequest.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    }),
  ]);

  // Trace durable dans le log central : survit à la rotation des 50 dernières
  // commandes de la console et à une éventuelle purge physique ultérieure.
  await recordDeveloperAudit("order.delete", "success", {
    orderId: order.id,
    ref: order.ref,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    total: order.total,
    status: order.status,
    itemsCount: order.items.length,
  });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/orders/to-process");
  revalidatePath("/zangochap-manager/dashboard");
  return { success: true };
}

// ============ UPDATE ORDER DETAILS (whitelist) ============
export async function updateOrderDetails(orderId: string, data: any) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || !checkOrderAccess(order, session)) throw new Error("Accès refusé");

  // SECURITY: whitelist only editable fields
  const ALLOWED_FIELDS = ['customerName', 'customerPhone', 'customerPhone2', 'customerLocation', 'commune', 'deliveryFee', 'deliveryNote', 'notes', 'total'] as const;
  const sanitized: Record<string, any> = {};
  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined) {
      sanitized[key] = (key === 'deliveryFee' || key === 'total') ? Number(data[key]) || 0 : String(data[key]);
    }
  }

  // Type de transaction : validé contre la liste connue (le modal d'édition permet de le changer)
  const ALLOWED_ORDER_TYPES = ['Standard', 'Echange', 'Express', 'Recuperation', 'Reprogrammé'];
  if (data.type !== undefined && ALLOWED_ORDER_TYPES.includes(String(data.type))) {
    if (session.role === "commercial" && data.type === "Echange" && order.type !== "Echange") {
      throw new Error("L’échange nécessite une validation administrateur. Utilisez Créer un échange.");
    }
    sanitized.type = String(data.type);
  }

  // Coherence relais : une edition libre ne doit ni orpheliner un colis relais
  // (marqueur [POINT_RELAIS] ecrase) ni passer une commande en "Boutique" sans marqueur.
  const relayFieldsTouched = ["commune", "customerLocation", "deliveryNote"].some((key) => key in sanitized);
  if (relayFieldsTouched) {
    const prevCommune = String(order.commune || "").trim().toLowerCase();
    const nextCommune = String(("commune" in sanitized ? sanitized.commune : order.commune) || "").trim().toLowerCase();
    const nextNote = "deliveryNote" in sanitized ? sanitized.deliveryNote : order.deliveryNote;

    if (nextCommune === RELAY_COMMUNE) {
      let relayName = getRelayNameFromMarker(order.deliveryNote) || String(order.customerLocation || "").trim() || null;
      const locationTouched = "customerLocation" in sanitized || "commune" in sanitized;
      if (locationTouched) {
        const requestedRelay = String(("customerLocation" in sanitized ? sanitized.customerLocation : order.customerLocation) || "").trim();
        if (!requestedRelay) {
          throw new Error("Veuillez sélectionner le point relais de livraison.");
        }
        const relayAccount = await prisma.user.findFirst({
          where: {
            role: Role.POINT_RELAIS,
            serviceLabel: { equals: requestedRelay, mode: "insensitive" },
          },
          select: { serviceLabel: true },
        });
        relayName = relayAccount?.serviceLabel?.trim() || null;
        if (!relayName) {
          throw new Error(`Aucun point relais nommé "${requestedRelay}". Sélectionnez une boutique existante.`);
        }
        sanitized.customerLocation = relayName;
      }
      if (!relayName) {
        throw new Error("Veuillez sélectionner le point relais de livraison.");
      }
      // Conserve la ligne marqueur existante (emplacement, note boutique) tant
      // qu'elle pointe vers la meme boutique ; sinon la reconstruit.
      const existingMarker = getRelayMarkerLine(order.deliveryNote);
      const markerLine = existingMarker && getRelayNameFromMarker(order.deliveryNote)?.toLowerCase() === relayName.toLowerCase()
        ? existingMarker
        : buildRelayMarkerLine(relayName);
      const rest = stripRelayMarker(nextNote);
      sanitized.deliveryNote = rest ? `${markerLine}\n${rest}` : markerLine;
    } else if (prevCommune === RELAY_COMMUNE && "commune" in sanitized) {
      // Sortie explicite du circuit relais : le marqueur ne doit pas survivre.
      sanitized.deliveryNote = stripRelayMarker(nextNote) ?? "";
    } else if ("deliveryNote" in sanitized && getRelayMarkerLine(order.deliveryNote) && !getRelayMarkerLine(nextNote)) {
      // Colis depose en boutique hors commune "Boutique" (conversion au depot) :
      // l'edition de la note ne doit pas effacer le rattachement au gerant.
      const rest = stripRelayMarker(nextNote);
      const markerLine = getRelayMarkerLine(order.deliveryNote) as string;
      sanitized.deliveryNote = rest ? `${markerLine}\n${rest}` : markerLine;
    }
  }

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({ at: new Date().toISOString(), action: "Détails modifiés", by: session.email, byName: session.name });

  try {
    // Uploads R2 AVANT la transaction : les appels réseau lents feraient expirer la tx
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item.isCustom && !item.image) {
          throw new Error("Une image est obligatoire pour chaque article personnalisé.");
        }
        if (item.image && item.image.startsWith('data:image')) {
          item.image = await uploadImage(item.image, `order-item-${Date.now()}`);
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      const shouldReconcileStock = !!(data.items && Array.isArray(data.items) && order.stockDecremented);
      if (shouldReconcileStock) {
        await restoreStockForOrder(order, session, 'ADJUSTMENT', tx);
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          ...sanitized,
          history,
          ...(shouldReconcileStock ? { stockDecremented: false } : {}),
        },
      });

      // Handle Items update if provided
      if (data.items && Array.isArray(data.items)) {
        const existingItems = await tx.orderItem.findMany({ where: { orderId: order.id } });
        const existingIds = existingItems.map(i => i.id);
        const incomingIds = data.items.map((i: any) => i.id).filter(Boolean);
        const newlyGiftedItems = data.items.filter((item: any) => {
          if (!item.isGift) return false;
          const existingItem = existingItems.find(existing => existing.id === item.id);
          return !existingItem?.isGift;
        });
        let editGiftDecision: 'APPROVED' | 'PENDING' = 'APPROVED';
        if (session.role?.toUpperCase() === 'COMMERCIAL' && newlyGiftedItems.length > 0) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gift-quota:${session.id}`}))`;
          const commercial = await tx.user.findUnique({ where: { id: session.id }, select: { giftMonthlyQuota: true, giftMonthlyValueQuota: true } });
          if (!commercial) throw new Error("Commercial introuvable.");
          const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
          const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
          const approved = await tx.orderItem.findMany({
            where: { isGift: true, giftCountsTowardQuota: true, giftApprovalStatus: 'APPROVED', order: { commercialId: session.id, deletedAt: null, status: { not: 'CANCELLED' }, createdAt: { gte: monthStart, lt: nextMonth } } },
            select: { qty: true, giftUnitValue: true },
          });
          const usedQuantity = approved.reduce((sum, item) => sum + item.qty, 0);
          const usedValue = approved.reduce((sum, item) => sum + item.qty * item.giftUnitValue, 0);
          const requestedQuantity = newlyGiftedItems.reduce((sum: number, item: any) => sum + (parseInt(item.qty) || 1), 0);
          const requestedValue = newlyGiftedItems.reduce((sum: number, item: any) => sum + (parseInt(item.qty) || 1) * (Number(item.originalPrice) || 0), 0);
          const exceeded = usedQuantity + requestedQuantity > commercial.giftMonthlyQuota
            || (commercial.giftMonthlyValueQuota > 0 && usedValue + requestedValue > commercial.giftMonthlyValueQuota);
          if (exceeded) {
            if (!data.giftRequestReason?.trim()) throw new Error("GIFT_APPROVAL_REQUIRED:Quota cadeau dépassé. Une autorisation administrateur est nécessaire.");
            editGiftDecision = 'PENDING';
          }
        }

        // Delete items that were removed
        const toDelete = existingIds.filter(id => !incomingIds.includes(id));
        if (toDelete.length > 0) {
          await tx.orderItem.deleteMany({ where: { id: { in: toDelete } } });
        }

        // Upsert items (images déjà uploadées avant la transaction)
        for (const item of data.items) {
          const imageUrl = item.image;

          const isExisting = item.id && existingIds.includes(item.id);
          const existingItem = existingItems.find(existing => existing.id === item.id);
          const isNewGift = Boolean(item.isGift && !existingItem?.isGift);
          const itemData = {
            productId: item.productId || null,
            variantId: item.variantId || null,
            name: item.name,
            size: item.size || '-',
            color: item.color || '-',
            qty: parseInt(item.qty) || 1,
            price: parseInt(item.price) || 0,
            emoji: item.emoji,
            image: imageUrl,
            isCustom: item.isCustom || false,
            isGift: item.isGift || false,
            ...(!item.isGift ? { giftCountsTowardQuota: false, giftUnitValue: 0, giftApprovalStatus: null } : {}),
            ...(isNewGift ? {
              giftCountsTowardQuota: true,
              giftUnitValue: Number(item.originalPrice) || 0,
              giftApprovalStatus: editGiftDecision,
            } : {}),
          };

          let savedItem;
          if (isExisting) {
            savedItem = await tx.orderItem.update({
              where: { id: item.id },
              data: itemData
            });
          } else {
            savedItem = await tx.orderItem.create({
              data: {
                ...itemData,
                orderId: order.id
              }
            });
          }
          if (!item.isGift && existingItem?.isGift) {
            await tx.giftApprovalRequest.updateMany({ where: { orderItemId: savedItem.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
          }
          if (isNewGift && editGiftDecision === 'PENDING') {
            await tx.giftApprovalRequest.create({
              data: {
                commercialId: session.id as string,
                commercialName: session.name,
                orderId: order.id,
                orderRef: order.ref,
                orderItemId: savedItem.id,
                giftName: savedItem.name,
                quantity: savedItem.qty,
                unitValue: savedItem.giftUnitValue,
                reason: data.giftRequestReason.trim(),
              },
            });
            await tx.chatMessage.create({
              data: {
                body: `🎁 Demande cadeau de ${session.name} pour la commande ${order.ref || order.id}. Motif : ${data.giftRequestReason.trim()}`,
                scope: 'ROLE', targetRole: 'ADMIN', senderId: session.id,
                senderName: session.name, senderRole: session.role as Role,
              },
            });
          }
        }

        if (shouldReconcileStock) {
          const updatedOrder = await tx.order.findUnique({
            where: { id: order.id },
            include: { items: true },
          });
          if (!updatedOrder) throw new Error("Commande introuvable après mise à jour");
          await decrementStockForOrder(updatedOrder, session, tx);
        }
      }
    }, { timeout: 15000 });
    revalidatePath("/zangochap-manager/orders");
  } catch (e: any) {
    console.error("Order Details Update Error:", e);
    throw new Error(e.message || "Erreur lors de la mise à jour des détails");
  }
}

// ============ ADD HISTORY ENTRY ============
export async function addOrderHistoryEntry(orderId: string, action: string) {
  const session = await getSession();
  if (!session) return;
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  if (!checkOrderAccess(order, session)) return;
  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({ at: new Date().toISOString(), action, by: session.email, byName: session.name });
  await prisma.order.update({ where: { id: orderId }, data: { history } });
}

// ============ HAND OFF WEB ORDER TO CALL CENTER ============
export async function takeToProcessOrder(orderId: string, commercialId?: string) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  const role = session.role?.toUpperCase();
  if (!['ADMIN', 'COMMERCIAL'].includes(role)) throw new Error("Accès refusé");

  const assigneeId = role === 'ADMIN' && commercialId ? commercialId : session.id;
  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!assignee || !['ADMIN', 'COMMERCIAL'].includes(assignee.role)) {
    throw new Error("Call center introuvable");
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.deletedAt) throw new Error("Commande introuvable");
  if (order.status !== 'TO_PROCESS') throw new Error("Cette commande est déjà prise en charge");

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: `Commande prise en charge par ${assignee.name}`,
    by: session.email,
    byName: session.name,
  });

  // Les commandes du site sont creees sans date de livraison : au moment de
  // leur prise en charge, planifier le prochain jour livrable (jamais dimanche).
  // Une date deja renseignee reste prioritaire.
  const now = new Date();
  const nextDeliveryOffset = now.getDay() === 6 ? 2 : 1;
  const nextDeliveryDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + nextDeliveryOffset,
    0,
    0,
    0,
    0,
  );

  let updatedOrder: any = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = order.ref || await generateUniqueRef(order.commune || undefined, order.type || undefined);
    try {
      updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          ref,
          status: 'CONFIRMED',
          commercialId: assignee.id,
          commercialName: assignee.name,
          confirmedAt: now,
          confirmedByName: assignee.name,
          deliveryDate: order.deliveryDate ?? nextDeliveryDate,
          history,
        },
        include: { items: true },
      });
      break;
    } catch (e: any) {
      const isRefCollision = e.code === 'P2002' && e.meta?.target?.includes('ref');
      if (isRefCollision && !order.ref && attempt < 9) continue;
      throw e;
    }
  }

  if (!updatedOrder) throw new Error("Impossible de générer une référence unique pour cette commande.");

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/orders/to-process");
  revalidatePath("/zangochap-manager/dashboard");
  return { order: JSON.parse(JSON.stringify(updatedOrder)) };
}

// ============ DUPLICATE ORDER ============
export async function duplicateOrder(orderId: string, data: any) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  const original = await prisma.order.findUnique({ where: { id: orderId } });
  if (!original || original.deletedAt || !checkOrderAccess(original, session)) throw new Error("Accès refusé à cette commande.");
  if (!["admin", "developer", "commercial"].includes(session.role)) throw new Error("Accès refusé.");
  if (session.role === "commercial" && data.type === "Echange") return requestOrderExchange(orderId, data);

  const baseNotes = String(data.notes || "").trim();
  let finalNotes = baseNotes;
  let exchangeRef: string | undefined;
  if (data.type === 'Echange') {
    const originalRef = String(original.ref || "").replace(/^ECHANGE/i, "");
    exchangeRef = `ECHANGE${originalRef}`;
    const exchangeLines = [`ECHANGE - Commande originale: ${original.ref}`];
    if (data.exchangeReason) exchangeLines.push(`MOTIF ECHANGE: ${data.exchangeReason}`);
    finalNotes = `${exchangeLines.join("\n")}${baseNotes ? `\n---\n${baseNotes}` : ''}`;
  }

  const newOrder = await createOrder({
    ...data,
    ref: exchangeRef,
    allowRefRetry: data.type === 'Echange',
    notes: finalNotes || `Dupliquée depuis ${original.ref}`,
  });

  return newOrder;
}

// ============ REPROGRAM ORDER ============
export async function reprogramOrder(orderId: string, data: any) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  const original = await prisma.order.findUnique({ where: { id: orderId } });
  if (!original || !checkOrderAccess(original, session)) throw new Error("Accès refusé");

  if (original.deletedAt) throw new Error("Commande supprimée.");
  if (!["admin", "developer", "commercial"].includes(session.role)) throw new Error("Reprogrammation réservée aux commerciaux et administrateurs.");

  const originalRef = String(original.ref || "").replace(/^REPRO/i, "");
  const reproRef = `REPRO${originalRef}`;
  const baseNotes = String(data.notes || "").trim();
  const finalNotes = `REPROGRAMMATION - Commande originale: ${original.ref}${baseNotes ? `\n---\n${baseNotes}` : ""}`;

  const newOrder = await createOrder({
    ...data,
    ref: reproRef,
    allowRefRetry: true,
    type: "Reprogrammé",
    status: "CONFIRMED",
    notes: finalNotes,
  });

  const history = Array.isArray(original.history) ? [...(original.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: `Nouvelle commande reprogrammée créée : ${newOrder.order.ref}`,
    by: session.email,
    byName: session.name,
  });
  await prisma.order.update({ where: { id: orderId }, data: { history } });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/logistics");
  revalidatePath("/zangochap-manager/logistics/collection");
  revalidatePath("/zangochap-manager/logistics/packing");
  return newOrder;
}

// ============ REASSIGN ORDER LEAD ============
export async function reassignOrderLead(orderId: string, newCommercialId: string) {
  const session = await ensureAuth(["admin"]);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.deletedAt) throw new Error("Commande introuvable");
  if (order.status !== 'TO_PROCESS') throw new Error("Cette commande n'est plus à traiter");

  const newCommercial = await prisma.user.findUnique({
    where: { id: newCommercialId },
    select: { id: true, name: true, role: true }
  });
  if (!newCommercial || newCommercial.role !== 'COMMERCIAL') {
    throw new Error("Commercial introuvable");
  }

  const oldName = order.commercialName || "Non assigné";
  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: `Réattribution manuelle du lead de ${oldName} à ${newCommercial.name}`,
    by: session.email,
    byName: session.name
  });

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      commercialId: newCommercial.id,
      commercialName: newCommercial.name,
      history
    }
  });

  revalidatePath("/zangochap-manager/orders/to-process");
  return { order: JSON.parse(JSON.stringify(updated)) };
}

// ============ UPDATE ROUND ROBIN ACTIVE COMMERCIALS ============
export async function updateRoundRobinActiveCommercials(activeCommercialIds: string[]) {
  const session = await ensureAuth(["admin"]);

  await prisma.$transaction(async (tx) => {
    // 1. Get or create RoundRobinState in cmsContent with row-level locking
    let stateRecord: any = null;
    const lockedRows: any[] = await tx.$queryRaw`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
    if (lockedRows && lockedRows.length > 0) {
      stateRecord = lockedRows[0];
    }

    let lastAssignedId = null;
    if (stateRecord) {
      try {
        const data = typeof stateRecord.data === 'string' ? JSON.parse(stateRecord.data) : stateRecord.data;
        lastAssignedId = data?.lastAssignedId || null;
      } catch (e) {
        console.error("Failed to parse round_robin_state data:", e);
      }
    }

    const updatedData = {
      lastAssignedId,
      activeCommercialIds
    };

    await tx.cmsContent.upsert({
      where: { key: 'round_robin_state' },
      create: {
        key: 'round_robin_state',
        data: updatedData,
        updatedBy: session.email
      },
      update: {
        data: updatedData,
        updatedBy: session.email
      }
    });
  });

  revalidatePath("/zangochap-manager/orders/to-process");
  return { success: true };
}
