import prisma from "@/lib/prisma";
import { OrderStatus, Prisma } from "@prisma/client";
import { getSession } from "@/modules/auth/actions";

type OrdersQueryParams = {
  page?: string | number | null;
  status?: string | null;
  commune?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  dateType?: string | null;
  scope?: string | null;
};

type SessionUser = {
  id: string;
  name: string;
  role: string;
};

type OrderHistoryEntry = {
  action?: string;
};

export type NonPackedOrdersPeriod = "today" | "yesterday" | "all";

export const ORDERS_PAGE_SIZE = 50;

const WEB_TO_PROCESS_WHERE = {
  deletedAt: null,
  status: OrderStatus.TO_PROCESS,
};

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

export function buildOrdersWhere(params: OrdersQueryParams, user: SessionUser | null | undefined) {
  const from = params.from ?? todayIso();
  const to = params.to ?? todayIso();

  const where: Record<string, unknown> = { deletedAt: null };

  if (params.status?.toUpperCase() === OrderStatus.TO_PROCESS) {
    where.id = "__to_process_orders_are_only_visible_on_the_to_process_page__";
  } else if (params.status && params.status !== "all") {
    where.status = params.status.toUpperCase() as OrderStatus;
  } else {
    where.status = { not: OrderStatus.TO_PROCESS };
  }

  if (params.commune && params.commune !== "all") {
    where.commune = params.commune;
  }

  if (params.q) {
    where.OR = [
      { ref: { contains: params.q, mode: "insensitive" } },
      { customerName: { contains: params.q, mode: "insensitive" } },
      { customerPhone: { contains: params.q } },
      { commercialName: { contains: params.q, mode: "insensitive" } },
    ];
  }

  if (from || to) {
    const dateField = params.dateType === "delivery" ? "deliveryDate" : "createdAt";
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(`${from}T00:00:00`);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59.999`);
    where[dateField] = dateFilter;
  }

  if (user?.role === "commercial" && params.scope !== "all") {
    const scopeFilter = { commercialId: user.id };

    if (where.OR) {
      const searchOR = where.OR;
      delete where.OR;
      where.AND = [{ OR: searchOR }, scopeFilter];
    } else {
      where.commercialId = user.id;
    }
  }

  return where;
}

export async function getOrdersListData(params: OrdersQueryParams, user: SessionUser | null | undefined) {
  const page = Math.max(1, parseInt(String(params.page || "1"), 10) || 1);
  const skip = (page - 1) * ORDERS_PAGE_SIZE;
  const where = buildOrdersWhere(params, user);

  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { items: true, commercial: true },
      take: ORDERS_PAGE_SIZE,
      skip,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, totalCount, page, pageSize: ORDERS_PAGE_SIZE };
}

export async function getOrdersStaffData() {
  const session = await getSession();
  const where: Prisma.UserWhereInput = {};
  if (!session || session.role !== "developer") {
    where.role = { not: "DEVELOPER" };
  }

  const staffUsers = await prisma.user.findMany({
    where,
    select: { id: true, name: true, phone: true, email: true, role: true },
  });

  return {
    staffUsers,
    deliverymen: staffUsers.filter((user) => user.phone),
  };
}

export async function getToProcessOrders(user?: SessionUser | null) {
  const where: Prisma.OrderWhereInput = {
    ...WEB_TO_PROCESS_WHERE,
  };
  if (user && user.role?.toLowerCase() === "commercial") {
    where.commercialId = user.id;
  }

  return prisma.order.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        include: {
          variant: true,
          product: {
            include: {
              images: {
                orderBy: { position: 'asc' },
                take: 1
              }
            }
          }
        }
      }
    },
  });
}

const ACTIVE_REMINDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.PARTIAL,
  OrderStatus.UNAVAILABLE,
  OrderStatus.ALTERNATIVE,
  OrderStatus.REPROGRAMMED,
  OrderStatus.REPRO_DISPO,
];

const DIRECT_REMINDER_STATUSES: OrderStatus[] = [
  OrderStatus.PARTIAL,
  OrderStatus.UNAVAILABLE,
  OrderStatus.ALTERNATIVE,
  OrderStatus.REPRO_DISPO,
];

const ISSUE_KEYWORDS = ["propose", "alternative", "indispo", "manque", "pas en stock", "épuisé", "rupture", "incomplet", "partiel"];
const ALTERNATIVE_KEYWORDS = ["propose", "alternative"];

function normalizeReminderText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isReminderIssueAction(action: unknown) {
  const normalizedAction = normalizeReminderText(action);
  return ISSUE_KEYWORDS.some((keyword) => normalizedAction.includes(normalizeReminderText(keyword)));
}

function isAlternativeReminderAction(action: unknown) {
  const normalizedAction = normalizeReminderText(action);
  return normalizedAction.includes("collection_status:alternative")
    || ALTERNATIVE_KEYWORDS.some((keyword) => normalizedAction.includes(keyword));
}

function getReminderMotifs(history: OrderHistoryEntry[]) {
  return Array.from(new Set(
    history
      .map((entry) => String(entry.action || "").trim())
      .filter((action) => /^note\s*:/i.test(action) || /motif/i.test(action))
      .map((action) => action.replace(/^note\s*:\s*/i, "").trim())
      .filter(Boolean),
  ));
}

function isDateInPeriod(date: Date, period: NonPackedOrdersPeriod, today: Date, yesterday: Date, tomorrow: Date) {
  if (period === "all") return true;
  if (period === "today") return date >= today && date < tomorrow;
  return date >= yesterday && date < today;
}

function getReminderDate(order: { createdAt: Date; updatedAt?: Date | null }, lastIssueEvent?: OrderHistoryEntry) {
  const issueDate = lastIssueEvent && "at" in lastIssueEvent
    ? new Date(String((lastIssueEvent as OrderHistoryEntry & { at?: unknown }).at || ""))
    : null;
  if (issueDate && !Number.isNaN(issueDate.getTime())) return issueDate;
  if (order.updatedAt instanceof Date && !Number.isNaN(order.updatedAt.getTime())) return order.updatedAt;
  return order.createdAt;
}

export async function getNonPackedOrdersData(
  user: SessionUser | null | undefined,
  period: NonPackedOrdersPeriod = "yesterday",
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const where: Record<string, unknown> = {
    deletedAt: null,
    status: { in: ACTIVE_REMINDER_STATUSES },
  };

  if (user?.role?.toLowerCase() === "commercial") {
    where.commercialId = user.id;
  }

  const allOrders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { items: true },
  });

  const notPacked: unknown[] = [];
  const withAlternatives: unknown[] = [];

  allOrders.forEach((order) => {
    const history = Array.isArray(order.history) ? (order.history as OrderHistoryEntry[]) : [];
    const lastIssueEvent = [...history].reverse().find((entry) => isReminderIssueAction(entry.action));

    if (!lastIssueEvent && !DIRECT_REMINDER_STATUSES.includes(order.status)) return;

    const reminderDate = getReminderDate(order, lastIssueEvent);
    if (!isDateInPeriod(reminderDate, period, today, yesterday, tomorrow)) return;

    const isAlternative = order.status === "ALTERNATIVE"
      || (order.status !== "UNAVAILABLE" && isAlternativeReminderAction(lastIssueEvent?.action));

    const orderWithMotif = {
      ...order,
      motif: lastIssueEvent?.action
        || (order.status === "ALTERNATIVE"
          ? "Alternative proposée"
          : order.status === "PARTIAL"
            ? "Emballage partiel"
            : order.status === "REPRO_DISPO"
              ? "Reprogrammation disponible"
              : "Problème de stock"),
      motifs: getReminderMotifs(history),
    };

    if (isAlternative) {
      withAlternatives.push(orderWithMotif);
    } else {
      notPacked.push(orderWithMotif);
    }
  });

  return { notPacked, withAlternatives };
}

export async function getNewOrderPageData(userId?: string) {
  const [salesStats, products, categories] = await Promise.all([
    userId
      ? prisma.orderItem.groupBy({
          by: ["productId"],
          where: {
            productId: { not: null },
            order: { status: { not: "CANCELLED" } },
          },
          _sum: { qty: true },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      include: { variants: true, supplier: true, category: true, images: true },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  const salesMap = new Map(salesStats.map((stat) => [stat.productId, stat._sum.qty || 0]));
  const sortedProducts = products.sort((a, b) => {
    const countA = salesMap.get(a.id) || 0;
    const countB = salesMap.get(b.id) || 0;
    if (countB !== countA) return countB - countA;
    return a.name.localeCompare(b.name);
  });

  return { products: sortedProducts, categories };
}

export async function getRoundRobinState() {
  const stateRecord = await prisma.cmsContent.findUnique({
    where: { key: 'round_robin_state' }
  });

  if (!stateRecord) {
    return { lastAssignedId: null, activeCommercialIds: [] };
  }

  try {
    const data = typeof stateRecord.data === 'string' ? JSON.parse(stateRecord.data) : stateRecord.data;
    return {
      lastAssignedId: data?.lastAssignedId || null,
      activeCommercialIds: data?.activeCommercialIds || []
    };
  } catch {
    return { lastAssignedId: null, activeCommercialIds: [] };
  }
}

export async function getNextRoundRobinCommercial() {
  const commercials = await prisma.user.findMany({
    where: { role: 'COMMERCIAL' },
    orderBy: { id: 'asc' },
    select: { id: true, name: true }
  });

  if (commercials.length === 0) return null;

  const stateRecord = await prisma.cmsContent.findUnique({
    where: { key: 'round_robin_state' }
  });

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

  let activeCommercials = commercials;
  if (activeCommercialIds && activeCommercialIds.length > 0) {
    activeCommercials = commercials.filter(c => activeCommercialIds.includes(c.id));
  }
  if (activeCommercials.length === 0) {
    activeCommercials = commercials;
  }

  if (!lastAssignedId) {
    return activeCommercials[0];
  }

  const lastIndex = activeCommercials.findIndex(c => c.id === lastAssignedId);
  if (lastIndex === -1) {
    return activeCommercials[0];
  }

  return activeCommercials[(lastIndex + 1) % activeCommercials.length];
}
