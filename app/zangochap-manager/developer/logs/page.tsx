import React from "react";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import Topbar from "@/components/Topbar";
import DeveloperConsoleClient from "./DeveloperConsoleClient";
import os from "os";

export const dynamic = "force-dynamic";

type DeveloperAuditLogRow = {
  id: string;
  action: string;
  status: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  details: unknown;
  createdAt: Date;
};

type OrderHistoryEntry = {
  action?: string;
  by?: string;
  at?: string;
};

type OrderLogRow = {
  orderRef: string;
  customerName: string;
  action: string;
  by: string;
  at: Date;
};

function isOrderHistoryEntry(value: unknown): value is OrderHistoryEntry {
  return Boolean(value && typeof value === "object" && "action" in value);
}

async function getDeveloperAuditLogs(): Promise<DeveloperAuditLogRow[]> {
  try {
    const tableExists = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'DeveloperAuditLog'
      ) AS "exists"
    `;
    if (!tableExists[0]?.exists) return [];

    return await prisma.$queryRaw<DeveloperAuditLogRow[]>`
      SELECT "id", "action", "status", "actorId", "actorName", "actorEmail", "details", "createdAt"
      FROM "DeveloperAuditLog"
      ORDER BY "createdAt" DESC
      LIMIT 50
    `;
  } catch {
    return [];
  }
}

export default async function DeveloperLogsPage() {
  const session = await getSession();
  if (!session || session.role !== "developer") {
    redirect("/zangochap-manager/dashboard");
  }

  // 1. Fetch dynamic database volumes in parallel (excellent performance)
  const [
    ordersCount,
    productsCount,
    variantsCount,
    usersCount,
    promosCount,
    warehousesCount,
    stockMovementsCount,
    settlementsCount,
    categoriesCount
  ] = await Promise.all([
    prisma.order.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.user.count(),
    prisma.promoCode.count(),
    prisma.warehouse.count(),
    prisma.stockMovement.count(),
    prisma.settlement.count(),
    prisma.category.count()
  ]);

  const dbMetrics = {
    orders: ordersCount,
    products: productsCount,
    variants: variantsCount,
    users: usersCount,
    promos: promosCount,
    warehouses: warehousesCount,
    stockMovements: stockMovementsCount,
    settlements: settlementsCount,
    categories: categoriesCount
  };

  // 2. Fetch recent stock movements
  const stockMovements = await prisma.stockMovement.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
    include: {
      variant: {
        include: {
          product: true
        }
      }
    }
  });

  const developerAuditLogs = await getDeveloperAuditLogs();

  // 3. Fetch recent orders with history logs
  const recentOrders = await prisma.order.findMany({
    take: 50,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      ref: true,
      customerName: true,
      status: true,
      history: true,
      updatedAt: true
    }
  });

  // 4. Extract list of history actions as order logs
  const orderLogs: OrderLogRow[] = [];
  recentOrders.forEach((order) => {
    if (order.history && Array.isArray(order.history)) {
      order.history.forEach((value) => {
        if (!isOrderHistoryEntry(value)) return;
        const h = value;
        orderLogs.push({
          orderRef: order.ref || "En attente",
          customerName: order.customerName,
          action: h.action || "-",
          by: h.by || "Système",
          at: new Date(h.at || order.updatedAt)
        });
      });
    }
  });

  // Sort order logs by date desc and limit to 50
  orderLogs.sort((a, b) => b.at.getTime() - a.at.getTime());
  const finalOrderLogs = orderLogs.slice(0, 50).map(log => ({
    ...log,
    at: log.at.toISOString()
  }));

  // 5. Retrieve process system resource usage
  const memoryUsage = process.memoryUsage();
  const formatMB = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 100) / 100} MB`;

  const uptimeSeconds = process.uptime();
  const formatUptime = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    return `${hrs}h ${mins}m ${secs}s`;
  };

  const sysInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    uptime: formatUptime(uptimeSeconds),
    rss: formatMB(memoryUsage.rss),
    heapTotal: formatMB(memoryUsage.heapTotal),
    heapUsed: formatMB(memoryUsage.heapUsed)
  };

  return (
    <>
      <Topbar title="Console & Outils" subtitle="Développement Zangochap" />
      <DeveloperConsoleClient
        sysInfo={sysInfo}
        dbMetrics={dbMetrics}
        stockMovements={JSON.parse(JSON.stringify(stockMovements))}
        orderLogs={finalOrderLogs}
        developerAuditLogs={JSON.parse(JSON.stringify(developerAuditLogs))}
      />
    </>
  );
}
