// Internal server-only creation service; never expose its transaction/session arguments as a Server Action.
import prisma from "@/lib/prisma";
import { Role, type OrderStatus, type CmsContent, type Prisma } from "@prisma/client";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import type { getSession } from "@/modules/auth/actions";
import { uploadImage } from "@/lib/upload";
import { generateUniqueRef, upsertCustomerFromOrder } from "../helpers";
import { notifyOrderCreatedWhatsApp } from "@/modules/whatsapp/send";
import { triggerAutomations } from "@/modules/automations/engine";
import { getExpeditionDayRange, isInExpeditionDay } from "../helpers/expedition-day";

function revalidatePath(path: string) {
  try { nextRevalidatePath(path); } catch { /* Preserve CLI compatibility of the existing creation action. */ }
}

function buildRelayMarkerLine(relayPointName: string, note?: string | null) {
  const clean = (value: string) => value.replace(/[|\r\n]+/g, " ").trim();
  return `[POINT_RELAIS] Boutique: ${clean(relayPointName)}${note ? ` | Note: ${clean(note)}` : ""}`;
}

export type OrderCreationInput = {
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
  isPaid?: boolean;
  paymentMethod?: string;
  depositSenderPhone?: string;
  depositTransactionRef?: string;
  status?: string;
  source?: 'public';
  allowRefRetry?: boolean;
  giftRequestReason?: string;
};

type ProcessedItem = Omit<OrderCreationInput["items"][number], "productId" | "variantId"> & {
  productId?: string | null;
  variantId?: string | null;
  _officialPromoGift?: boolean;
};

export async function createOrderWithContext(data: OrderCreationInput, session: Awaited<ReturnType<typeof getSession>>, transaction?: Prisma.TransactionClient) {
  const database = transaction ?? prisma;
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

    const relayAccount = await database.user.findFirst({
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
  const processedItems: ProcessedItem[] = [];

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
      const variant = await database.productVariant.findFirst({
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
  const requiresPayment = !isWebOrder && (isExpedition || data.isPaid === true || (data.isPaid !== false && !!data.paymentMethod?.trim()));
  if (requiresPayment && !data.paymentMethod?.trim()) {
    throw new Error("Le moyen de paiement est obligatoire pour une commande soldée ou une expédition hors Abidjan.");
  }
  const depositSenderPhone = String(data.depositSenderPhone || '').replace(/\D/g, '');
  if (requiresPayment && !depositSenderPhone) {
    throw new Error("Le numéro ayant effectué le paiement est obligatoire pour une commande soldée ou une expédition hors Abidjan.");
  }
  const isStaffExchange = !isWebOrder && data.type === 'Echange'
    && !!session && ['admin', 'developer', 'commercial'].includes(session.role.toLowerCase());
  if (isExpedition && data.type !== 'Reprogrammé' && !isStaffExchange) {
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
      const expeditionDay = getExpeditionDayRange();

      const sameDayExpeditions = await database.order.findMany({
        where: {
          deletedAt: null,
          status: { not: 'CANCELLED' },
          createdAt: expeditionDay,
          commune: { equals: data.commune.trim(), mode: 'insensitive' },
        },
        include: { items: true },
      });

      const newSignature = itemSignature(processedItems);
      const duplicate = sameDayExpeditions.find(o => {
        // Never let an earlier creation block a repeat purchase, even if it
        // was delivered, reprogrammed or otherwise updated today.
        if (!isInExpeditionDay(o.createdAt, expeditionDay)) return false;
        const existingSuffixes = [toSuffix(o.customerPhone), toSuffix(o.customerPhone2)].filter(Boolean);
        const samePhone = existingSuffixes.some(s => newSuffixes.includes(s));
        return samePhone && itemSignature(o.items) === newSignature;
      });

      if (duplicate) {
        throw new Error(
          `⚠️ Expédition refusée : la commande ${duplicate.ref || duplicate.id}, créée le ${duplicate.createdAt.toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })} (heure d'Abidjan), contient les mêmes articles pour ce numéro. Cette restriction s'applique uniquement aux commandes créées le même jour.`,
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
  }, database);

  // Validate promo code & inject GIFT products if necessary
  processedItems.forEach(item => delete item._officialPromoGift);
  if (data.promoCode) {
    const promo = await database.promoCode.findUnique({
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
        const usageCount = await database.promoUsage.count({
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
          const phoneUsage = await database.promoUsage.findFirst({
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
        const customerUsage = await database.order.findFirst({
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
        const giftProduct = await database.product.findUnique({
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
  const status: OrderStatus = isWebOrder ? 'TO_PROCESS' : ((staffStatus as OrderStatus) || 'CONFIRMED');
  const requestedRef = isWebOrder ? undefined : data.ref;
  const shouldGenerateRef = !isWebOrder;
  const manualGiftProductIds = processedItems
    .filter(item => item.isGift && !item._officialPromoGift && item.productId)
    .map(item => item.productId as string);
  const giftProducts = manualGiftProductIds.length > 0
    ? await database.product.findMany({ where: { id: { in: manualGiftProductIds } }, select: { id: true, price: true } })
    : [];
  const giftValueByProduct = new Map(giftProducts.map(product => [product.id, Number(product.price)]));

  // ATOMIC RETRY LOOP: handles concurrency collisions on staff-created refs.
  let order;
  for (let attempt = 0; attempt < 10; attempt++) {
    const ref = requestedRef && attempt === 0
      ? requestedRef
      : shouldGenerateRef
        ? await generateUniqueRef(data.commune || undefined, data.type, database)
        : null;
    try {
      const persistOrder = async (tx: Prisma.TransactionClient) => {
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
            paymentMethod: requiresPayment || isWebOrder ? data.paymentMethod?.trim() || null : null,
            depositSenderPhone: requiresPayment || isExpedition ? depositSenderPhone || null : null,
            depositTransactionRef: requiresPayment || isExpedition ? data.depositTransactionRef?.trim() || null : null,
            depositVerificationStatus: isExpedition && !isWebOrder ? 'PENDING' : null,
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
                senderRole: session.role.toUpperCase() as Role,
              },
            });
          }
        }
        return createdOrder;
      };
      order = transaction ? await persistOrder(transaction) : await prisma.$transaction(persistOrder);
      break;
    } catch (e) {
      if (transaction) throw e;
      const error = e as { code?: string; meta?: { target?: string[]; field_name?: string; constraint?: string } };
      // P2002 is Prisma code for Unique constraint violation
      const isRefCollision = error.code === 'P2002' && error.meta?.target?.includes('ref');
      if (requestedRef && isRefCollision && !data.allowRefRetry) {
        throw new Error(`La référence ${requestedRef} existe déjà.`);
      }
      if (isRefCollision && attempt < 9) {
        continue;
      }
      const foreignKeyField = String(error.meta?.field_name || error.meta?.constraint || '');
      if (error.code === 'P2003' && foreignKeyField.includes('commercialId')) {
        throw new Error("Le compte commercial associé à la session est introuvable. Veuillez vous reconnecter.");
      }
      throw e;
    }
  }

  if (!order) throw new Error("Échec de création de la commande après plusieurs tentatives.");

  // Record promo usage if applicable
  if (data.promoCode) {
    try {
      await database.promoUsage.create({
        data: {
          promoCode: data.promoCode,
          orderId: order.id,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          orderTotal: finalTotal + (data.deliveryFee || 0)
        }
      });
    } catch (e) {
      if (transaction) throw e;
      console.error("Failed to record promo usage:", e);
    }
  }

  // Confirmation WhatsApp automatique (activable dans la console admin WhatsApp).
  // Uniquement pour les commandes confirmees a la prise (pas les web TO_PROCESS) ;
  // best-effort : n'echoue jamais la creation.
  if (!transaction && status === 'CONFIRMED') {
    await notifyOrderCreatedWhatsApp(order);
  }

  // Automatisations « Commande créée » (best-effort : ne bloque jamais la création).
  if (!transaction) await triggerAutomations({ type: 'order.created', order });

  if (!transaction) revalidatePath("/zangochap-manager/orders");
  if (!transaction) revalidatePath("/zangochap-manager/orders/to-process");
  if (!transaction) revalidatePath("/zangochap-manager/dashboard");

  return { order: JSON.parse(JSON.stringify(order)) };
}


async function getNextCommercialForAssignment(tx: Prisma.TransactionClient) {
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
  let stateRecord: CmsContent | null = null;
  const lockedRows = await tx.$queryRaw<CmsContent[]>`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
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
      const retryRows = await tx.$queryRaw<CmsContent[]>`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
      if (retryRows && retryRows.length > 0) {
        stateRecord = retryRows[0];
      }
    } catch {
      // If concurrent insert occurs, fetch the inserted record with lock
      const retryRows = await tx.$queryRaw<CmsContent[]>`SELECT * FROM "CmsContent" WHERE key = 'round_robin_state' FOR UPDATE`;
      if (retryRows && retryRows.length > 0) {
        stateRecord = retryRows[0];
      }
    }
  }

  let lastAssignedId: string | null = null;
  let activeCommercialIds: string[] = [];
  if (stateRecord) {
    try {
      const data: unknown = typeof stateRecord.data === 'string' ? JSON.parse(stateRecord.data) : stateRecord.data;
      if (data && typeof data === "object") {
        if ("lastAssignedId" in data && typeof data.lastAssignedId === "string") lastAssignedId = data.lastAssignedId;
        if ("activeCommercialIds" in data && Array.isArray(data.activeCommercialIds)) activeCommercialIds = data.activeCommercialIds.filter((id): id is string => typeof id === "string");
      }
    } catch (e) {
      console.error("Failed to parse round_robin_state data:", e);
    }
  }

  // 3. Filter commercials to only those in activeCommercialIds (if set)
  let activeCommercials = commercials;
  if (activeCommercialIds && activeCommercialIds.length > 0) {
    activeCommercials = commercials.filter(c => activeCommercialIds.includes(c.id));
  }

  // If after filtering we have no active commercials, fallback to all commercials
  if (activeCommercials.length === 0) {
    activeCommercials = commercials;
  }

  // 4. Determine next commercial
  let nextIndex = 0;
  if (lastAssignedId) {
    const lastIndex = activeCommercials.findIndex(c => c.id === lastAssignedId);
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

