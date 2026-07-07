"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";

// Donnees clients (PII) : reservees au staff. Sans garde, ces server actions
// exposees etaient invocables anonymement (l'ID d'action se lit dans le bundle).
const STAFF_ROLES = ["admin", "developer", "commercial", "collection", "packing", "stock", "comptable"];

/**
 * Récupère les clients avec recherche par nom ou téléphone
 */
export async function getCustomers(query?: string) {
  await ensureAuth(STAFF_ROLES);
  const where: any = {};
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query } },
    ];
  }

  return prisma.customer.findMany({
    where,
    orderBy: { lastOrderAt: 'desc' },
    take: 10, // Limiter pour l'autocomplétion
  });
}

/**
 * Met à jour ou crée un client lors d'une commande
 */
export async function upsertCustomerFromOrder(data: {
  name: string;
  phone: string;
  phone2?: string;
  location?: string;
  commune?: string;
  orderAmount: number;
}) {
  await ensureAuth(STAFF_ROLES);
  const customer = await prisma.customer.upsert({
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

  return customer;
}
