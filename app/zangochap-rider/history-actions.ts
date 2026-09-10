"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import type { Prisma, OrderStatus } from "@prisma/client";
import type { RiderOrder } from "./types";

const statuses: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"];

export async function getRiderHistory(input: { from: string; to: string; status: string; search: string; page: number }) {
  const user = await getSession();
  if (!user || !["LIVREUR", "ADMIN", "DEVELOPER"].includes(user.role.toUpperCase())) throw new Error("Accès refusé");
  const parseDay = (value: string) => {
    const date = new Date(value + "T00:00:00.000Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Date invalide");
    return date;
  };
  const from = parseDay(input.from);
  const end = parseDay(input.to);
  if (from > end) throw new Error("La date de début doit précéder la date de fin.");
  end.setUTCDate(end.getUTCDate() + 1);
  const range = { gte: from, lt: end };
  const fallback: Prisma.OrderWhereInput = { OR: [
    { deliveryDate: range }, { deliveryDate: null, updatedAt: range },
  ] };
  const eventDate: Prisma.OrderWhereInput = { OR: [
    { status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] }, OR: [
      { deliveredAt: { gte: from.toISOString(), lt: end.toISOString() } },
      { deliveredAt: null, ...fallback },
    ] },
    { status: { in: ["RETURNED", "CANCELLED", "REPRO_DISPO"] }, OR: [
      { lastDeliveryAttemptAt: range }, { lastDeliveryAttemptAt: null, ...fallback },
    ] },
  ] };
  const search = input.search.trim().slice(0, 120);
  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    status: { in: statuses.includes(input.status as OrderStatus) ? [input.status as OrderStatus] : statuses },
    AND: [
      { OR: [
        { deliverymanId: user.id },
        { lastDeliveryAttemptRiderId: user.id, status: { in: ["RETURNED", "CANCELLED", "REPRO_DISPO"] } },
      ] },
      eventDate,
      ...(search ? [{ OR: ["ref", "customerName", "customerPhone", "commune", "customerLocation"].map(field => ({ [field]: { contains: search, mode: "insensitive" } })) } as Prisma.OrderWhereInput] : []),
    ],
  };
  const requestedPage = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page)) : 1;
  return prisma.$transaction(async tx => {
    const total = await tx.order.count({ where });
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / 30)));
    const rows = await tx.order.findMany({
      where, orderBy: [{ deliveryDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * 30, take: 30,
      include: { items: true, commercial: { select: { name: true, phone: true } } },
    });
    const orders: RiderOrder[] = rows.map(o => ({
      ...o, ref: o.ref || o.id,
      deliveryDate: o.deliveryDate?.toISOString() || null,
      lastDeliveryAttemptAt: o.lastDeliveryAttemptAt?.toISOString() || null,
      createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
    }));
    return { orders, total, page, pages: Math.max(1, Math.ceil(total / 30)) };
  }, { isolationLevel: "RepeatableRead" });
}
