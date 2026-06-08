"use server";

import prisma from "@/lib/prisma";
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
}) {
  const session = await getSession();

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

  const customer = await upsertCustomerFromOrder({
    name: data.customerName,
    phone: data.customerPhone,
    phone2: data.customerPhone2,
    location: data.customerLocation,
    commune: data.commune,
    orderAmount: finalTotal + (data.deliveryFee || 0),
  });

  // Validate promo code & inject GIFT products if necessary
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
          if (!hasGiftItem) {
            processedItems.push({
              productId: giftProduct.id,
              name: `[CADEAU] ${giftProduct.name}`,
              price: 0,
              qty: 1,
              size: "Standard",
              color: "Standard",
              isGift: true,
              emoji: giftProduct.emoji || '🎁'
            });
          }
        }
      }
    } else {
      throw new Error("Code promo introuvable.");
    }
  }

  const isWebOrder = data.source === 'public' || !session;
  const requestedStatus = data.status?.toUpperCase();
  const staffStatus = requestedStatus === 'TO_PROCESS' ? 'CONFIRMED' : requestedStatus;
  const status = isWebOrder ? 'TO_PROCESS' : ((staffStatus as any) || 'CONFIRMED');
  const requestedRef = isWebOrder ? undefined : data.ref;
  const shouldGenerateRef = !isWebOrder;

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

        return tx.order.create({
          data: {
            ...(ref ? { ref } : {}),
            customerId: customer.id,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerPhone2: data.customerPhone2,
            customerLocation: data.customerLocation,
            commune: data.commune,
            total: finalTotal,
            deliveryFee: Number(data.deliveryFee || 0),
            deliveryNote: data.deliveryNote,
            paymentMethod: data.paymentMethod,
            status,
            commercialId: isWebOrder ? (assignedCommercial?.id || null) : (session?.id || null),
            commercialName: isWebOrder ? (assignedCommercial?.name || "Site Web") : (session?.name || null),
            deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
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
            ],
          },
          include: { items: true },
        });
      });
      break;
    } catch (e: any) {
      // P2002 is Prisma code for Unique constraint violation
      const isRefCollision = e.code === 'P2002' && e.meta?.target?.includes('ref');
      if (requestedRef && isRefCollision && !data.allowRefRetry) {
        throw new Error(`La référence ${requestedRef} existe déjà.`);
      }
      if (isRefCollision && attempt < 9) {
        console.log(`Ref collision detected on ${ref}, retrying... (attempt ${attempt + 1})`);
        continue;
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

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/orders/to-process");
  revalidatePath("/zangochap-manager/dashboard");

  return { order: JSON.parse(JSON.stringify(order)) };
}

// ============ DELETE ORDER (SOFT DELETE) ============
export async function deleteOrder(orderId: string) {
  const session = await getSession();
  if (!session || !['admin', 'commercial', 'developer'].includes(session.role?.toLowerCase())) throw new Error("Accès refusé");
  
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
  await prisma.order.update({ 
    where: { id: orderId }, 
    data: { 
      status: 'CANCELLED',
      deletedAt: new Date(),
      ...(order.ref
        ? { ref: order.ref.startsWith('[SUPPRIMÉ]') ? order.ref : `[SUPPRIMÉ] ${order.ref}` }
        : {}),
      history,
      stockDecremented: false // Ensure it stays false after restoration
    } 
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

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({ at: new Date().toISOString(), action: "Détails modifiés", by: session.email, byName: session.name });

  try {
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

        // Delete items that were removed
        const toDelete = existingIds.filter(id => !incomingIds.includes(id));
        if (toDelete.length > 0) {
          await tx.orderItem.deleteMany({ where: { id: { in: toDelete } } });
        }

        // Process images for new items and Upsert
        for (const item of data.items) {
          if (item.isCustom && !item.image) {
            throw new Error("Une image est obligatoire pour chaque article personnalisé.");
          }

          let imageUrl = item.image;
          if (imageUrl && imageUrl.startsWith('data:image')) {
            imageUrl = await uploadImage(imageUrl, `order-item-${Date.now()}`);
          }

          const isExisting = item.id && existingIds.includes(item.id);
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
          };

          if (isExisting) {
            await tx.orderItem.update({
              where: { id: item.id },
              data: itemData
            });
          } else {
            await tx.orderItem.create({
              data: {
                ...itemData,
                orderId: order.id
              }
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
    });
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
          confirmedAt: new Date(),
          confirmedByName: assignee.name,
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
