"use server";

import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
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
import { checkOrderAccess, generateUniqueRef, upsertCustomerFromOrder } from "../helpers";
import { decrementStockForOrder, restoreStockForOrder } from "./stock";
import { notifyOrderCreatedWhatsApp } from "@/modules/whatsapp/send";
import { triggerAutomations } from "@/modules/automations/engine";
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
export async function createOrder(data: {
  ref?: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerPhone2?: string;
  customerLocation: string;
  commune: string;
  deliveryFee?: number;
  deliveryNote?: string;
  items: Array<{
    productId?: string;
    variantId?: string;
    name: string;
    size: string;
    color: string;
    qty: number;
    price: number;
    emoji?: string;
    image?: string;
    isCustom?: boolean;
    isGift?: boolean;
    originalPrice?: number;
    notes?: string;
    desc?: string;
  }>;
  promoCode?: string;
  discount?: number;
  notes?: string;
  type?: string;
  total?: number;
  deliveryDate?: string;
  paymentMethod?: string;
  status?: string;
  source?: 'public';
  allowRefRetry?: boolean;
  giftRequestReason?: string;
}) {
  const session = await getSession();
  const isWebOrder = data.source === 'public';

  if (!isWebOrder && !session) {
    throw new Error("Votre session n'est plus valide. Veuillez vous reconnecter avant de créer la commande.");
  }

  // Date de livraison : parse en minuit LOCAL (et non UTC) pour rester coherent avec
  // les comparaisons cote livreur et comptabilite. Obligatoire et non passee pour les
  // commandes back-office (call center / admin) ; optionnelle pour le site public.
  let parsedDeliveryDate: Date | null = null;
  if (data.deliveryDate) {
    parsedDeliveryDate = new Date(`${data.deliveryDate}T00:00:00`);
    if (Number.isNaN(parsedDeliveryDate.getTime())) {
      throw new Error("Date de livraison invalide.");
    }
  }
  if (!isWebOrder) {
    if (!parsedDeliveryDate) {
      throw new Error("La date de livraison prévue est obligatoire.");
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (parsedDeliveryDate < todayStart) {
      throw new Error("La date de livraison ne peut pas être dans le passé.");
    }
  }

  const isRelayDelivery = data.commune.trim().toLowerCase() === "boutique";
  let relayPointName: string | null = null;

  if (isRelayDelivery) {
    const requestedRelay = data.customerLocation.trim();
    if (!requestedRelay) {
      throw new Error("Veuillez sélectionner le point relais de livraison.");
    }

    const relayAccount = await prisma.user.findFirst({
      where: {
        role: Role.POINT_RELAIS,
        serviceLabel: { equals: requestedRelay, mode: "insensitive" },
        isPaused: false,
      },
      select: { serviceLabel: true },
    });

    relayPointName = relayAccount?.serviceLabel?.trim() || null;
    if (!relayPointName) {
      throw new Error("Ce point relais n'existe plus. Actualisez la page et sélectionnez une boutique disponible.");
    }
  }

  const deliveryLocation = relayPointName || data.customerLocation;
  const relayDeliveryNote = relayPointName
    ? buildRelayMarkerLine(relayPointName, data.deliveryNote)
    : data.deliveryNote;

  // Process images & resolve product IDs. Rupture items remain orderable:
  // they are collected/restocked before packing decrements stock.
  const processedItems: any[] = [];

  for (const item of data.items) {
    if (item.isCustom && !item.image) {
      throw new Error("Une image est obligatoire pour chaque article personnalisé.");
    }

    if (item.image && item.image.startsWith('data:image')) {
      item.image = await uploadImage(item.image, `order-item-${Date.now()}`);
    }

    // Custom items: no product creation; stored directly as OrderItem.
    const productId = item.isCustom ? null : (item.productId || null);
    let variantId = item.isCustom ? null : (item.variantId || null);

    if (!variantId && productId && item.size && item.color) {
      const variant = await prisma.productVariant.findFirst({
        where: {
          productId,
          size: item.size,
          color: item.color,
        },
        select: { id: true },
      });
      variantId = variant?.id || null;
    }

    processedItems.push({
      ...item,
      productId,
      variantId
    });
  }

  const calculatedTotal = processedItems.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const finalTotal = data.total !== undefined ? Number(data.total) : calculatedTotal;

  // ============ ANTI-FRAUDE EXPÉDITION ============
  // Bloque une expédition (Hors Abidjan) identique le même jour : même numéro
  // + mêmes articles = ruse client fréquente pour se faire livrer deux fois.
  // Les reprogrammations restent autorisées (flux légitime).
  const isExpedition = data.commune?.trim().toLowerCase() === 'hors abidjan';
  if (isExpedition && data.type !== 'Reprogrammé') {
    const toSuffix = (p?: string | null) => {
      const digits = String(p || '').replace(/\D/g, '');
      return digits.length >= 8 ? digits.slice(-8) : '';
    };
    const newSuffixes = [toSuffix(data.customerPhone), toSuffix(data.customerPhone2)].filter(Boolean);

    // Signature des articles : produit + taille + couleur + quantité (cadeaux promo exclus)
    const itemSignature = (items: Array<{ productId?: string | null; name: string; size?: string | null; color?: string | null; qty: number; isGift?: boolean | null }>) =>
      items
        .filter(i => !i.isGift)
        .map(i => `${i.productId || String(i.name).trim().toLowerCase()}|${String(i.size || '').trim().toLowerCase()}|${String(i.color || '').trim().toLowerCase()}|${Number(i.qty)}`)
        .sort()
        .join('§');

    if (newSuffixes.length > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const sameDayExpeditions = await prisma.order.findMany({
        where: {
          deletedAt: null,
          status: { not: 'CANCELLED' },
          createdAt: { gte: todayStart },
          commune: { equals: data.commune.trim(), mode: 'insensitive' },
        },
        include: { items: true },
      });

      const newSignature = itemSignature(processedItems);
      const duplicate = sameDayExpeditions.find(o => {
        const existingSuffixes = [toSuffix(o.customerPhone), toSuffix(o.customerPhone2)].filter(Boolean);
        const samePhone = existingSuffixes.some(s => newSuffixes.includes(s));
        return samePhone && itemSignature(o.items) === newSignature;
      });

      if (duplicate) {
        throw new Error(
          `⚠️ Expédition refusée : la commande ${duplicate.ref || duplicate.id} a déjà été enregistrée aujourd'hui pour ce numéro avec exactement les mêmes articles. Doublon probable — vérifiez avant de recréer.`,
        );
      }
    }
  }

  const customer = await upsertCustomerFromOrder({
    name: data.customerName,
    phone: data.customerPhone,
    phone2: data.customerPhone2,
    location: deliveryLocation,
    commune: data.commune,
    orderAmount: finalTotal + (data.deliveryFee || 0),
  });

  // Validate promo code & inject GIFT products if necessary
  processedItems.forEach(item => delete item._officialPromoGift);
  if (data.promoCode) {
    const promo = await prisma.promoCode.findUnique({
      where: { code: data.promoCode },
      include: {
        products: { select: { id: true } },
        categories: { select: { id: true } }
      }
    });

    if (promo) {
      const now = new Date();
      if (!promo.isActive) {
        throw new Error("Ce code promo n'est plus actif.");
      }
      if (promo.startDate && promo.startDate > now) {
        throw new Error("Ce code promo n'est pas encore valide.");
      }
      if (promo.endDate && promo.endDate < now) {
        throw new Error("Ce code promo a expiré.");
      }

      // Check global limit
      if (promo.maxGlobalUses !== null) {
        const usageCount = await prisma.promoUsage.count({
          where: { promoCode: promo.code }
        });
        if (usageCount >= promo.maxGlobalUses) {
          throw new Error("La limite d'utilisation globale de ce code promo a été atteinte.");
        }
      }

      // Check Phone limit (ONCE_PER_PHONE)
      if (promo.rule === 'ONCE_PER_PHONE') {
        const cleanPhone = data.customerPhone.replace(/[\s\-\+\(\)]/g, '');
        if (cleanPhone.length >= 8) {
          const suffix = cleanPhone.substring(cleanPhone.length - 8);
          const phoneUsage = await prisma.promoUsage.findFirst({
            where: {
              promoCode: promo.code,
              customerPhone: { contains: suffix }
            }
          });
          if (phoneUsage) {
            throw new Error("Ce code promo a déjà été utilisé avec ce numéro de téléphone.");
          }
        }
      }

      // Check Customer limit (ONCE_PER_CUSTOMER)
      if (promo.rule === 'ONCE_PER_CUSTOMER' && customer.id) {
        const customerUsage = await prisma.order.findFirst({
          where: {
            customerId: customer.id,
            promoCode: promo.code
          }
        });
        if (customerUsage) {
          throw new Error("Ce code promo a déjà été utilisé par ce client.");
        }
      }

      // Handle GIFT insertion
      if (promo.type === 'GIFT' && promo.giftProductId) {
        const giftProduct = await prisma.product.findUnique({
          where: { id: promo.giftProductId }
        });
        if (giftProduct) {
          const hasGiftItem = processedItems.some(item => item.productId === giftProduct.id && item.isGift);
          if (hasGiftItem) {
            const promoGiftItem = processedItems.find(item => item.productId === giftProduct.id && item.isGift);
            if (promoGiftItem) {
              promoGiftItem.qty = 1;
              promoGiftItem.price = 0;
              promoGiftItem._officialPromoGift = true;
            }
          }
          if (!hasGiftItem) {
            processedItems.push({
              productId: giftProduct.id,
              name: `[CADEAU] ${giftProduct.name}`,
              price: 0,
              qty: 1,
              size: "Standard",
              color: "Standard",
              isGift: true,
              originalPrice: Number(giftProduct.price),
              emoji: giftProduct.emoji || '🎁',
              _officialPromoGift: true,
            });
          }
        }
      }
    } else {
      throw new Error("Code promo introuvable.");
    }
  }

  const requestedStatus = data.status?.toUpperCase();
  const staffStatus = requestedStatus === 'TO_PROCESS' ? 'CONFIRMED' : requestedStatus;
  const status = isWebOrder ? 'TO_PROCESS' : ((staffStatus as any) || 'CONFIRMED');
  const requestedRef = isWebOrder ? undefined : data.ref;
  const shouldGenerateRef = !isWebOrder;
  const manualGiftProductIds = processedItems
    .filter(item => item.isGift && !item._officialPromoGift && item.productId)
    .map(item => item.productId as string);
  const giftProducts = manualGiftProductIds.length > 0
    ? await prisma.product.findMany({ where: { id: { in: manualGiftProductIds } }, select: { id: true, price: true } })
    : [];
  const giftValueByProduct = new Map(giftProducts.map(product => [product.id, Number(product.price)]));

  // ATOMIC RETRY LOOP: handles concurrency collisions on staff-created refs.
  let order;
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = requestedRef && attempt === 0
      ? requestedRef
      : shouldGenerateRef
        ? await generateUniqueRef(data.commune || undefined, data.type)
        : null;
    try {
      order = await prisma.$transaction(async (tx) => {
        let assignedCommercial = null;
        if (isWebOrder) {
          assignedCommercial = await getNextCommercialForAssignment(tx);
        }

        const quotaApplies = !isWebOrder && session?.role?.toUpperCase() === 'COMMERCIAL';
        let giftDecision: 'APPROVED' | 'PENDING' = 'APPROVED';
        const manualGifts = processedItems.filter(item => item.isGift && !item._officialPromoGift);
        if (quotaApplies && session?.id && manualGifts.length > 0) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gift-quota:${session.id}`}))`;
          const commercial = await tx.user.findUnique({
            where: { id: session.id },
            select: { giftMonthlyQuota: true, giftMonthlyValueQuota: true },
          });
          if (!commercial) throw new Error("Commercial introuvable.");
          const monthStart = new Date();
          monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
          const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
          const approved = await tx.orderItem.findMany({
            where: {
              isGift: true,
              giftCountsTowardQuota: true,
              giftApprovalStatus: 'APPROVED',
              order: { commercialId: session.id, deletedAt: null, status: { not: 'CANCELLED' }, createdAt: { gte: monthStart, lt: nextMonth } },
            },
            select: { qty: true, giftUnitValue: true },
          });
          const usedQuantity = approved.reduce((sum, item) => sum + item.qty, 0);
          const usedValue = approved.reduce((sum, item) => sum + item.qty * item.giftUnitValue, 0);
          const requestedQuantity = manualGifts.reduce((sum, item) => sum + Number(item.qty), 0);
          const requestedValue = manualGifts.reduce((sum, item) => {
            const unitValue = Number(item.originalPrice || giftValueByProduct.get(item.productId || '') || 0);
            return sum + Number(item.qty) * unitValue;
          }, 0);
          const quantityExceeded = usedQuantity + requestedQuantity > commercial.giftMonthlyQuota;
          const valueExceeded = commercial.giftMonthlyValueQuota > 0
            && usedValue + requestedValue > commercial.giftMonthlyValueQuota;
          if (quantityExceeded || valueExceeded) {
            if (!data.giftRequestReason?.trim()) {
              throw new Error(`GIFT_APPROVAL_REQUIRED:Quota cadeau dépassé. ${commercial.giftMonthlyQuota - usedQuantity} cadeau(x) restant(s).`);
            }
            giftDecision = 'PENDING';
          }
        }

        const createdOrder = await tx.order.create({
          data: {
            ...(ref ? { ref } : {}),
            customerId: customer.id,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerPhone2: data.customerPhone2,
            customerLocation: deliveryLocation,
            commune: data.commune,
            total: finalTotal,
            deliveryFee: Number(data.deliveryFee || 0),
            deliveryNote: relayDeliveryNote,
            paymentMethod: data.paymentMethod,
            status,
            commercialId: isWebOrder ? (assignedCommercial?.id || null) : (session?.id || null),
            commercialName: isWebOrder ? (assignedCommercial?.name || "Site Web") : (session?.name || null),
            deliveryDate: parsedDeliveryDate,
            promoCode: data.promoCode,
            discount: Number(data.discount || 0),
            notes: data.notes,
            type: data.type,
            confirmedAt: status === 'CONFIRMED' ? new Date() : null,
            confirmedByName: status === 'CONFIRMED' ? session?.name || null : null,
            items: {
              create: processedItems.map(item => ({
                name: item.name,
                size: item.size,
                color: item.color,
                qty: Number(item.qty),
                price: Number(item.price),
                emoji: item.emoji || 'P',
                image: item.image || null,
                productId: item.productId,
                variantId: item.variantId,
                isCustom: item.isCustom || false,
                isGift: item.isGift || false,
                giftCountsTowardQuota: item.isGift ? !item._officialPromoGift : false,
                giftUnitValue: item.isGift
                  ? Number(item.originalPrice || giftValueByProduct.get(item.productId || '') || 0)
                  : 0,
                giftApprovalStatus: item.isGift
                  ? (item._officialPromoGift ? 'APPROVED' : giftDecision)
                  : null,
                notes: item.notes || item.desc || null,
              })),
            },
            history: [
              {
                at: new Date().toISOString(),
                action: isWebOrder
                  ? `Commande passée sur le site web (Attribuée à ${assignedCommercial?.name || "aucun commercial"})`
                  : "Commande créée par commercial",
                by: isWebOrder ? "public" : session?.email,
                byName: isWebOrder ? "Client Web" : session?.name,
              },
              ...(relayPointName ? [{
                at: new Date().toISOString(),
                action: `Point relais : commande attribuée à ${relayPointName}`,
                by: isWebOrder ? "public" : session?.email,
                byName: isWebOrder ? "Client Web" : session?.name,
              }] : []),
            ],
          },
          include: { items: true },
        });
        if (giftDecision === 'PENDING' && session?.id) {
          const pendingGiftItems = createdOrder.items.filter(item => item.isGift && item.giftCountsTowardQuota);
          if (pendingGiftItems.length > 0) {
            await tx.giftApprovalRequest.createMany({
              data: pendingGiftItems.map(item => ({
                commercialId: session.id as string,
                commercialName: session.name,
                orderId: createdOrder.id,
                orderRef: createdOrder.ref,
                orderItemId: item.id,
                giftName: item.name,
                quantity: item.qty,
                unitValue: item.giftUnitValue,
                reason: data.giftRequestReason!.trim(),
              })),
            });
            await tx.chatMessage.create({
              data: {
                body: `🎁 Demande cadeau de ${session.name} pour la commande ${createdOrder.ref || createdOrder.id}. Motif : ${data.giftRequestReason!.trim()}`,
                scope: 'ROLE',
                targetRole: 'ADMIN',
                senderId: session.id,
                senderName: session.name,
                senderRole: session.role as Role,
              },
            });
          }
        }
        return createdOrder;
      });
      break;
    } catch (e: any) {
      // P2002 is Prisma code for Unique constraint violation
      const isRefCollision = e.code === 'P2002' && e.meta?.target?.includes('ref');
      if (requestedRef && isRefCollision && !data.allowRefRetry) {
        throw new Error(`La référence ${requestedRef} existe déjà.`);
      }
      if (isRefCollision && attempt < 9) {
        continue;
      }
      const foreignKeyField = String(e.meta?.field_name || e.meta?.constraint || '');
      if (e.code === 'P2003' && foreignKeyField.includes('commercialId')) {
        throw new Error("Le compte commercial associé à la session est introuvable. Veuillez vous reconnecter.");
      }
      throw e;
    }
  }

  if (!order) throw new Error("Échec de création de la commande après plusieurs tentatives.");

  // Record promo usage if applicable
  if (data.promoCode) {
    try {
      await prisma.promoUsage.create({
        data: {
          promoCode: data.promoCode,
          orderId: order.id,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          orderTotal: finalTotal + (data.deliveryFee || 0)
        }
      });
    } catch (e) {
      console.error("Failed to record promo usage:", e);
    }
  }

  // Confirmation WhatsApp automatique (activable dans la console admin WhatsApp).
  // Uniquement pour les commandes confirmees a la prise (pas les web TO_PROCESS) ;
  // best-effort : n'echoue jamais la creation.
  if (status === 'CONFIRMED') {
    await notifyOrderCreatedWhatsApp(order);
  }

  // Automatisations « Commande créée » (best-effort : ne bloque jamais la création).
  await triggerAutomations({ type: 'order.created', order });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/orders/to-process");
  revalidatePath("/zangochap-manager/dashboard");

  return { order: JSON.parse(JSON.stringify(order)) };
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
  if (!original) throw new Error("Commande originale introuvable");

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

async function getNextCommercialForAssignment(tx: any) {
  // 1. Get all commercials sorted by id
  const commercials = await tx.user.findMany({
    where: { role: 'COMMERCIAL' },
    orderBy: { id: 'asc' },
    select: { id: true, name: true }
  });

  if (commercials.length === 0) {
    return null;
  }

  // 2. Get or create RoundRobinState in cmsContent with row-level locking
  let stateRecord: any = null;
  const lockedRows: any[] = await tx.$queryRaw`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
  if (lockedRows && lockedRows.length > 0) {
    stateRecord = lockedRows[0];
  }

  if (!stateRecord) {
    try {
      stateRecord = await tx.cmsContent.create({
        data: {
          key: 'round_robin_state',
          data: { lastAssignedId: null }
        }
      });
      // Lock it for our transaction
      const retryRows: any[] = await tx.$queryRaw`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
      if (retryRows && retryRows.length > 0) {
        stateRecord = retryRows[0];
      }
    } catch (e) {
      // If concurrent insert occurs, fetch the inserted record with lock
      const retryRows: any[] = await tx.$queryRaw`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
      if (retryRows && retryRows.length > 0) {
        stateRecord = retryRows[0];
      }
    }
  }

  let lastAssignedId: string | null = null;
  let activeCommercialIds: string[] = [];
  if (stateRecord) {
    try {
      const data = typeof stateRecord.data === 'string' ? JSON.parse(stateRecord.data) : stateRecord.data;
      lastAssignedId = data?.lastAssignedId || null;
      activeCommercialIds = data?.activeCommercialIds || [];
    } catch (e) {
      console.error("Failed to parse round_robin_state data:", e);
    }
  }

  // 3. Filter commercials to only those in activeCommercialIds (if set)
  let activeCommercials = commercials;
  if (activeCommercialIds && activeCommercialIds.length > 0) {
    activeCommercials = commercials.filter((c: any) => activeCommercialIds.includes(c.id));
  }

  // If after filtering we have no active commercials, fallback to all commercials
  if (activeCommercials.length === 0) {
    activeCommercials = commercials;
  }

  // 4. Determine next commercial
  let nextIndex = 0;
  if (lastAssignedId) {
    const lastIndex = activeCommercials.findIndex((c: any) => c.id === lastAssignedId);
    if (lastIndex !== -1) {
      nextIndex = (lastIndex + 1) % activeCommercials.length;
    }
  }

  const nextCommercial = activeCommercials[nextIndex];

  // 5. Update state
  await tx.cmsContent.update({
    where: { key: 'round_robin_state' },
    data: {
      data: {
        lastAssignedId: nextCommercial.id,
        activeCommercialIds
      }
    }
  });

  return nextCommercial;
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
