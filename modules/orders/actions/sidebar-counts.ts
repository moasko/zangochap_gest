import { OrderStatus, type Prisma, type Role } from "@prisma/client";
import prisma from "@/lib/prisma";

export type SidebarCounts = {
  orders: number;
  packing: number;
  collection: number;
  toProcess: number;
  myDeliveries: number;
  chatUnread: number;
  riderChatUnread: number;
};

export type SidebarCountsUser = {
  id?: string | null;
  role?: string | null;
};

export const emptySidebarCounts: SidebarCounts = {
  orders: 0,
  packing: 0,
  collection: 0,
  toProcess: 0,
  myDeliveries: 0,
  chatUnread: 0,
  riderChatUnread: 0,
};

const STAFF_ROLES = ["DEVELOPER", "ADMIN", "COMMERCIAL", "PACKING", "COLLECTION", "STOCK", "LIVREUR"] as const;

export async function getSidebarCountsForUser(user?: SidebarCountsUser | null): Promise<SidebarCounts> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeOrderWhere = { deletedAt: null };
  const role = user?.role?.toLowerCase();

  const toProcessWhere: Prisma.OrderWhereInput = {
    ...activeOrderWhere,
    status: OrderStatus.TO_PROCESS,
  };
  if (user?.id && role === "commercial") {
    toProcessWhere.commercialId = user.id;
  }

  const roleUpper = String(user?.role || "").toUpperCase() as Role;
  const canUseChat = Boolean(user?.id) && STAFF_ROLES.includes(roleUpper as typeof STAFF_ROLES[number]);

  const chatVisibleWhere: Prisma.ChatMessageWhereInput | undefined = canUseChat
    ? {
        deletedAt: null,
        senderId: { not: user!.id! },
        reads: { none: { userId: user!.id! } },
        OR: [
          { scope: "GENERAL" as const },
          { scope: "ROLE" as const, targetRole: roleUpper },
          {
            scope: "DIRECT" as const,
            OR: [
              { senderId: user!.id! },
              { recipientId: user!.id! },
            ],
          },
        ],
      }
    : undefined;

  const [ordersCount, packingCount, collectionCount, toProcessCount, deliveriesCount, chatUnreadCount, riderChatUnreadCount] = await Promise.all([
    prisma.order.count({
      where: {
        ...activeOrderWhere,
        status: OrderStatus.CONFIRMED,
        createdAt: { gte: today },
      },
    }),
    prisma.order.count({
      where: {
        ...activeOrderWhere,
        status: OrderStatus.CONFIRMED,
        createdAt: { gte: today },
      },
    }),
    prisma.order.count({
      where: {
        ...activeOrderWhere,
        status: {
          in: [OrderStatus.CONFIRMED, OrderStatus.PENDING, OrderStatus.PARTIAL],
        },
        createdAt: { gte: today },
      },
    }),
    prisma.order.count({
      where: toProcessWhere,
    }),
    user?.id && role === "livreur"
      ? prisma.order.count({
          where: {
            ...activeOrderWhere,
            deliverymanId: user.id,
            status: {
              notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
            },
          },
        })
      : Promise.resolve(0),
    chatVisibleWhere
      ? prisma.chatMessage.count({ where: chatVisibleWhere })
      : Promise.resolve(0),
    chatVisibleWhere
      ? prisma.chatMessage.count({
          where: {
            ...chatVisibleWhere,
            senderRole: "LIVREUR",
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    orders: ordersCount,
    packing: packingCount,
    collection: collectionCount,
    toProcess: toProcessCount,
    myDeliveries: deliveriesCount,
    chatUnread: chatUnreadCount,
    riderChatUnread: riderChatUnreadCount,
  };
}
