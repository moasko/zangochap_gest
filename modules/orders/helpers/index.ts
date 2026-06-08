import prisma from "@/lib/prisma";
import { COMMUNES } from "@/lib/constants";

// ============ ROLE HELPER ============
export function isRole(session: any, ...roles: string[]) {
  if (!session?.role) return false;
  const r = session.role.toLowerCase();
  return roles.some(role => role.toLowerCase() === r);
}

// ============ ACCESS HELPER ============
export function checkOrderAccess(order: any, session: any) {
  if (!session) return false;
  const role = session.role?.toUpperCase();

  if (role === 'ADMIN' || role === 'DEVELOPER') return true;
  
  if (role === 'COMMERCIAL') {
    return order.commercialId === session.id;
  }

  if (role === 'LIVREUR') {
    return order.deliverymanId === session.id;
  }

  if (['PACKING', 'STOCK', 'COLLECTION'].includes(role)) return true;

  return false;
}

// ============ REF GENERATOR ============
export async function generateUniqueRef(commune?: string, typePrefix?: string) {
  const communePrefix = (commune && COMMUNES[commune]) || 'BJ';
  const suffixMinLength = 5;

  // Better normalization: NFD + strip non-alphanumeric
  const normalize = (text: string) => text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();

  const basePrefix = typePrefix && typePrefix !== 'Standard'
    ? `${normalize(typePrefix)}${communePrefix}`
    : communePrefix;

  // Keep the numeric part unique globally, including older refs that were
  // generated before this counter format existed.
  const existingRefs = await prisma.order.findMany({
    select: { ref: true },
  });

  const usedSequences = new Set<number>();
  for (const o of existingRefs) {
    if (!o.ref) continue;

    const match = o.ref.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isSafeInteger(num) && num > 0) {
        usedSequences.add(num);
      }
    }
  }

  // Keep refs readable: prefix + zero-padded counter, then keep counting after 99999.
  for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence++) {
    if (usedSequences.has(sequence)) continue;

    const sequenceStr = sequence.toString().padStart(suffixMinLength, '0');
    const candidate = `${basePrefix}${sequenceStr}`;
    const existing = await prisma.order.findUnique({ where: { ref: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }

  throw new Error("Impossible de générer une référence courte disponible.");
}

// ============ CUSTOMER UPSERT ============
export async function upsertCustomerFromOrder(data: {
  name: string; phone: string; phone2?: string; location?: string; commune?: string; orderAmount: number;
}) {
  return prisma.customer.upsert({
    where: { phone: data.phone },
    update: {
      name: data.name,
      phone2: data.phone2,
      location: data.location,
      commune: data.commune,
      totalOrders: { increment: 1 },
      totalSpent: { increment: data.orderAmount },
      lastOrderAt: new Date(),
    },
    create: {
      name: data.name,
      phone: data.phone,
      phone2: data.phone2,
      location: data.location,
      commune: data.commune,
      totalOrders: 1,
      totalSpent: data.orderAmount,
      lastOrderAt: new Date(),
    },
  });
}

// ============ WAREHOUSE HELPER ============
export async function getOrCreateDefaultWarehouse() {
  const existing = await prisma.warehouse.findFirst({
    where: {
      OR: [
        { name: "Entrepôt Principal" },
        { name: "Entrepôt  principal" },
        { name: "Entrepot Principal" },
        { name: "Entrepot  principal" },
        { name: "Magasin Principal" },
      ],
    },
  });

  if (existing) return existing;

  return prisma.warehouse.create({
    data: {
      name: "Entrepôt Principal",
      location: "Siège Zangochap"
    }
  });
}
