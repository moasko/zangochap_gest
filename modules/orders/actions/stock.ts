import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";

type StockTx = any;

type StockSession = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
};

type StockMovementType = "SALE" | "RESTOCK" | "RETURN" | "EXCHANGE" | "ADJUSTMENT" | "DAMAGE" | "LOSS";

export class InsufficientStockError extends Error {
  readonly code = "INSUFFICIENT_STOCK";

  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

const DEFAULT_WAREHOUSE_CANDIDATES = [
  "Entrepôt Principal",
  "Entrepôt  principal",
  "Entrepot Principal",
  "Entrepot  principal",
  "Magasin Principal",
];

function cleanQty(value: number) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function actor(session: StockSession) {
  return {
    by: session.id || session.email || "system",
    byName: session.name || session.email || "Système",
  };
}

async function getOrCreateDefaultWarehouseTx(tx: StockTx = prisma) {
  const warehouses = await tx.warehouse.findMany({
    where: { name: { in: DEFAULT_WAREHOUSE_CANDIDATES } },
  });

  const ranked = warehouses.sort((a: any, b: any) => {
    const aRank = DEFAULT_WAREHOUSE_CANDIDATES.indexOf(a.name);
    const bRank = DEFAULT_WAREHOUSE_CANDIDATES.indexOf(b.name);
    return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank);
  });

  if (ranked[0]) return ranked[0];

  return tx.warehouse.create({
    data: {
      name: "Entrepôt Principal",
      location: "Siège Zangochap",
    },
  });
}

async function syncVariantAndProductStockTx(tx: StockTx, variantId: string) {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, productId: true },
  });
  if (!variant) return;

  const variantStock = await tx.stockLevel.aggregate({
    where: { variantId },
    _sum: { quantity: true },
  });
  const normalizedVariantStock = cleanQty(variantStock._sum.quantity || 0);

  await tx.productVariant.update({
    where: { id: variantId },
    data: { stock: normalizedVariantStock },
  });

  const productVariants = await tx.productVariant.findMany({
    where: { productId: variant.productId },
    select: { stock: true },
  });
  const productStock = productVariants.reduce((sum: number, item: any) => sum + cleanQty(item.stock), 0);

  await tx.product.update({
    where: { id: variant.productId },
    data: { stock: productStock },
  });
}

async function recordStockMovementTx(data: {
  variantId: string;
  warehouseId?: string | null;
  type: StockMovementType;
  quantity: number;
  reason?: string;
  orderId?: string;
  session: StockSession;
}, tx: StockTx = prisma) {
  const user = actor(data.session);
  await tx.stockMovement.create({
    data: {
      variantId: data.variantId,
      warehouseId: data.warehouseId || null,
      type: data.type,
      quantity: Math.trunc(Number(data.quantity) || 0),
      reason: data.reason,
      orderId: data.orderId,
      by: user.by,
      byName: user.byName,
    },
  });
}

export async function recordStockMovement(data: Parameters<typeof recordStockMovementTx>[0], tx: StockTx = prisma) {
  return recordStockMovementTx(data, tx);
}

async function incrementVariantStock(data: {
  variantId: string;
  warehouseId?: string;
  quantity: number;
  type: Exclude<StockMovementType, "SALE" | "DAMAGE" | "LOSS">;
  reason?: string;
  orderId?: string;
  session: StockSession;
}, tx: StockTx = prisma) {
  const quantity = cleanQty(data.quantity);
  if (quantity <= 0) return;

  const warehouse = data.warehouseId
    ? { id: data.warehouseId }
    : await getOrCreateDefaultWarehouseTx(tx);

  await tx.stockLevel.upsert({
    where: {
      variantId_warehouseId: {
        variantId: data.variantId,
        warehouseId: warehouse.id,
      },
    },
    update: { quantity: { increment: quantity } },
    create: {
      variantId: data.variantId,
      warehouseId: warehouse.id,
      quantity,
    },
  });

  await recordStockMovementTx({
    variantId: data.variantId,
    warehouseId: warehouse.id,
    type: data.type,
    quantity,
    reason: data.reason,
    orderId: data.orderId,
    session: data.session,
  }, tx);

  await syncVariantAndProductStockTx(tx, data.variantId);
}

async function decrementVariantStock(data: {
  variantId: string;
  quantity: number;
  type: "SALE" | "DAMAGE" | "LOSS" | "ADJUSTMENT";
  reason?: string;
  orderId?: string;
  session: StockSession;
}, tx: StockTx = prisma) {
  let remaining = cleanQty(data.quantity);
  if (remaining <= 0) return;

  const levels = await tx.stockLevel.findMany({
    where: { variantId: data.variantId, quantity: { gt: 0 } },
    orderBy: [{ quantity: "desc" }, { id: "asc" }],
  });

  const available = levels.reduce((sum: number, level: any) => sum + cleanQty(level.quantity), 0);
  if (available < remaining) {
    const variant = await tx.productVariant.findUnique({
      where: { id: data.variantId },
      include: { product: { select: { name: true } } },
    });
    throw new InsufficientStockError(`Stock insuffisant pour ${variant?.product?.name || "ce produit"} (${available} disponible, ${remaining} demandé). Réapprovisionnez cette variante avant de l'emballer.`);
  }

  for (const level of levels) {
    if (remaining <= 0) break;
    const taken = Math.min(cleanQty(level.quantity), remaining);

    const updated = await tx.stockLevel.updateMany({
      where: { id: level.id, quantity: { gte: taken } },
      data: { quantity: { decrement: taken } },
    });

    if (updated.count !== 1) {
      const currentStock = await tx.stockLevel.aggregate({
        where: { variantId: data.variantId },
        _sum: { quantity: true },
      });
      throw new InsufficientStockError(
        `Le stock vient d'être utilisé par une autre commande (${cleanQty(currentStock._sum.quantity || 0)} disponible). Actualisez puis réessayez.`,
      );
    }

    await recordStockMovementTx({
      variantId: data.variantId,
      warehouseId: level.warehouseId,
      type: data.type,
      quantity: -taken,
      reason: data.reason,
      orderId: data.orderId,
      session: data.session,
    }, tx);

    remaining -= taken;
  }

  await syncVariantAndProductStockTx(tx, data.variantId);
}

export async function decrementStockForOrder(order: any, session: StockSession, tx: StockTx = prisma) {
  if (order.stockDecremented) return;

  const claimed = await tx.order.updateMany({
    where: { id: order.id, stockDecremented: false },
    data: { stockDecremented: true },
  });
  if (claimed.count !== 1) return;

  const quantitiesByVariant = new Map<string, number>();

  for (const item of order.items) {
    if (item.isCustom || item.isGift || !item.productId) continue;

    const variant = item.variantId
      ? await tx.productVariant.findUnique({ where: { id: item.variantId } })
      : await tx.productVariant.findFirst({
        where: { productId: item.productId, size: item.size, color: item.color },
      });

    if (!variant) continue;

    quantitiesByVariant.set(
      variant.id,
      (quantitiesByVariant.get(variant.id) || 0) + cleanQty(item.qty),
    );
  }

  // Stable ordering reduces lock contention when bulk packing shares variants.
  for (const [variantId, quantity] of [...quantitiesByVariant.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    await decrementVariantStock({
      variantId,
      quantity,
      type: "SALE",
      orderId: order.id,
      session,
      reason: `Commande ${order.ref || order.id}`,
    }, tx);
  }
}

export async function restoreStockForOrder(
  order: any,
  session: StockSession,
  type: "RETURN" | "EXCHANGE" | "ADJUSTMENT" = "RETURN",
  tx: StockTx = prisma,
) {
  for (const item of order.items) {
    if (item.isCustom || item.isGift || !item.productId) continue;

    const variant = item.variantId
      ? await tx.productVariant.findUnique({ where: { id: item.variantId } })
      : await tx.productVariant.findFirst({
        where: { productId: item.productId, size: item.size, color: item.color },
      });

    if (!variant) continue;

    const lastMovement = await tx.stockMovement.findFirst({
      where: { orderId: order.id, variantId: variant.id, type: "SALE" },
      orderBy: { createdAt: "desc" },
    });

    const targetWarehouse = lastMovement?.warehouseId
      ? { id: lastMovement.warehouseId }
      : await getOrCreateDefaultWarehouseTx(tx);

    await incrementVariantStock({
      variantId: variant.id,
      warehouseId: targetWarehouse.id,
      quantity: item.qty,
      type,
      orderId: order.id,
      session,
      reason: `Restauration commande ${order.ref || order.id}`,
    }, tx);
  }
}

export async function restoreStockForOrderItem(data: {
  order: any;
  item: any;
  quantity: number;
  session: StockSession;
  type?: "RETURN" | "RESTOCK" | "EXCHANGE" | "ADJUSTMENT";
  reason?: string;
}, tx: StockTx = prisma) {
  if (data.item.isCustom || data.item.isGift || !data.item.productId) return;

  const variant = data.item.variantId
    ? await tx.productVariant.findUnique({ where: { id: data.item.variantId } })
    : await tx.productVariant.findFirst({
      where: { productId: data.item.productId, size: data.item.size, color: data.item.color },
    });

  if (!variant) return;

  const lastMovement = await tx.stockMovement.findFirst({
    where: { orderId: data.order.id, variantId: variant.id, type: "SALE" },
    orderBy: { createdAt: "desc" },
  });

  const targetWarehouse = lastMovement?.warehouseId
    ? { id: lastMovement.warehouseId }
    : await getOrCreateDefaultWarehouseTx(tx);

  await incrementVariantStock({
    variantId: variant.id,
    warehouseId: targetWarehouse.id,
    quantity: data.quantity,
    type: data.type || "RESTOCK",
    orderId: data.order.id,
    session: data.session,
    reason: data.reason,
  }, tx);
}

export async function restockVariant(data: {
  variantId: string;
  warehouseId?: string;
  quantity: number;
  type?: "RESTOCK" | "RETURN" | "EXCHANGE" | "ADJUSTMENT";
  reason?: string;
  orderId?: string;
  session: StockSession;
}, tx: StockTx = prisma) {
  return incrementVariantStock({
    variantId: data.variantId,
    warehouseId: data.warehouseId,
    quantity: data.quantity,
    type: data.type || "RESTOCK",
    reason: data.reason,
    orderId: data.orderId,
    session: data.session,
  }, tx);
}

export async function setVariantWarehouseStock(data: {
  variantId: string;
  warehouseId: string;
  newQuantity: number;
  reason?: string;
  session: StockSession;
  sync?: boolean;
}, tx: StockTx = prisma) {
  const newQuantity = cleanQty(data.newQuantity);
  const current = await tx.stockLevel.findUnique({
    where: {
      variantId_warehouseId: {
        variantId: data.variantId,
        warehouseId: data.warehouseId,
      },
    },
  });
  const currentQuantity = cleanQty(current?.quantity || 0);
  const delta = newQuantity - currentQuantity;

  await tx.stockLevel.upsert({
    where: {
      variantId_warehouseId: {
        variantId: data.variantId,
        warehouseId: data.warehouseId,
      },
    },
    update: { quantity: newQuantity },
    create: {
      variantId: data.variantId,
      warehouseId: data.warehouseId,
      quantity: newQuantity,
    },
  });

  if (delta !== 0) {
    await recordStockMovementTx({
      variantId: data.variantId,
      warehouseId: data.warehouseId,
      type: "ADJUSTMENT",
      quantity: delta,
      reason: data.reason || `Ajustement stock: ${currentQuantity} -> ${newQuantity}`,
      session: data.session,
    }, tx);
  }

  if (data.sync !== false) {
    await syncVariantAndProductStockTx(tx, data.variantId);
  }
}

export async function transferVariantStock(data: {
  variantId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  reason?: string;
  session: StockSession;
}, tx: StockTx = prisma) {
  const quantity = cleanQty(data.quantity);
  if (quantity <= 0) throw new Error("La quantité à transférer doit être supérieure à 0.");
  if (data.fromWarehouseId === data.toWarehouseId) throw new Error("Choisissez deux entrepôts différents.");

  const source = await tx.stockLevel.findUnique({
    where: {
      variantId_warehouseId: {
        variantId: data.variantId,
        warehouseId: data.fromWarehouseId,
      },
    },
  });
  const available = cleanQty(source?.quantity || 0);
  if (available < quantity) {
    throw new Error(`Stock source insuffisant (${available} disponible, ${quantity} demandé).`);
  }

  await tx.stockLevel.update({
    where: { id: source!.id },
    data: { quantity: { decrement: quantity } },
  });

  await tx.stockLevel.upsert({
    where: {
      variantId_warehouseId: {
        variantId: data.variantId,
        warehouseId: data.toWarehouseId,
      },
    },
    update: { quantity: { increment: quantity } },
    create: {
      variantId: data.variantId,
      warehouseId: data.toWarehouseId,
      quantity,
    },
  });

  await recordStockMovementTx({
    variantId: data.variantId,
    warehouseId: data.fromWarehouseId,
    type: "ADJUSTMENT",
    quantity: -quantity,
    reason: data.reason || "Transfert sortant",
    session: data.session,
  }, tx);

  await recordStockMovementTx({
    variantId: data.variantId,
    warehouseId: data.toWarehouseId,
    type: "ADJUSTMENT",
    quantity,
    reason: data.reason || "Transfert entrant",
    session: data.session,
  }, tx);

  await syncVariantAndProductStockTx(tx, data.variantId);
}

export async function getStockHistory() {
  await ensureAuth(["admin", "stock"]);
  const movements = await prisma.stockMovement.findMany({
    include: {
      variant: { include: { product: true } },
      warehouse: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return movements;
}
