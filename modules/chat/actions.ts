"use server";

import { revalidatePath } from "next/cache";
import type { ChatMessageScope, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";

const STAFF_ROLES = ["DEVELOPER", "ADMIN", "COMMERCIAL", "PACKING", "COLLECTION", "STOCK", "LIVREUR"] as const;

export type ChatRoomKey = "GENERAL" | "ROLE" | "DIRECT";

export type ChatMessageView = {
  id: string;
  body: string;
  scope: ChatMessageScope;
  targetRole: Role | null;
  recipientId: string | null;
  senderId: string | null;
  senderName: string;
  senderRole: Role;
  isPinned: boolean;
  createdAt: string;
  readByMe: boolean;
};

export type ChatUserView = {
  id: string;
  name: string;
  email: string;
  role: Role;
  initials: string | null;
};

export type ChatSnapshot = {
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  users: ChatUserView[];
  messages: ChatMessageView[];
  unreadCount: number;
};

function normalizeRole(role?: string | null) {
  return String(role || "").toUpperCase() as Role;
}

function ensureStaffRole(role: Role) {
  if (!STAFF_ROLES.includes(role as typeof STAFF_ROLES[number])) {
    throw new Error("Acces chat reserve a l'equipe.");
  }
}

async function requireChatSession() {
  const session = await getSession();
  if (!session?.id) throw new Error("Non authentifie");

  const role = normalizeRole(session.role);
  ensureStaffRole(role);

  return {
    id: String(session.id),
    name: String(session.name || "Equipe"),
    email: String(session.email || ""),
    role,
  };
}

function visibleMessageWhere(userId: string, role: Role) {
  return {
    deletedAt: null,
    OR: [
      { scope: "GENERAL" as const },
      { scope: "ROLE" as const, targetRole: role },
      {
        scope: "DIRECT" as const,
        OR: [
          { senderId: userId },
          { recipientId: userId },
        ],
      },
    ],
  };
}

export async function getChatSnapshot(): Promise<ChatSnapshot> {
  const user = await requireChatSession();

  const [users, messages, unreadCount] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: { in: [...STAFF_ROLES] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        initials: true,
      },
      orderBy: [
        { role: "asc" },
        { name: "asc" },
      ],
    }),
    prisma.chatMessage.findMany({
      where: visibleMessageWhere(user.id, user.role),
      select: {
        id: true,
        body: true,
        scope: true,
        targetRole: true,
        recipientId: true,
        senderId: true,
        senderName: true,
        senderRole: true,
        isPinned: true,
        createdAt: true,
        reads: {
          where: { userId: user.id },
          select: { id: true },
        },
      },
      orderBy: [
        { isPinned: "desc" },
        { createdAt: "desc" },
      ],
      take: 160,
    }),
    prisma.chatMessage.count({
      where: {
        ...visibleMessageWhere(user.id, user.role),
        senderId: { not: user.id },
        reads: { none: { userId: user.id } },
      },
    }),
  ]);

  return {
    currentUser: user,
    users,
    messages: messages.reverse().map((message) => ({
      id: message.id,
      body: message.body,
      scope: message.scope,
      targetRole: message.targetRole,
      recipientId: message.recipientId,
      senderId: message.senderId,
      senderName: message.senderName,
      senderRole: message.senderRole,
      isPinned: message.isPinned,
      createdAt: message.createdAt.toISOString(),
      readByMe: message.senderId === user.id || message.reads.length > 0,
    })),
    unreadCount,
  };
}

export async function sendChatMessage(data: {
  body: string;
  scope: ChatRoomKey;
  targetRole?: Role | null;
  recipientId?: string | null;
  isPinned?: boolean;
}) {
  const user = await requireChatSession();
  const body = data.body.trim();

  if (body.length < 1) throw new Error("Message vide.");
  if (body.length > 1200) throw new Error("Message trop long.");

  let scope: ChatMessageScope = "GENERAL";
  let targetRole: Role | null = null;
  let recipientId: string | null = null;

  if (data.scope === "ROLE") {
    scope = "ROLE";
    targetRole = data.targetRole || user.role;
    ensureStaffRole(targetRole);
  }

  if (data.scope === "DIRECT") {
    scope = "DIRECT";
    if (!data.recipientId) throw new Error("Choisissez un destinataire.");
    const recipient = await prisma.user.findUnique({
      where: { id: data.recipientId },
      select: { id: true, role: true },
    });
    if (!recipient) throw new Error("Destinataire introuvable.");
    ensureStaffRole(recipient.role);
    recipientId = recipient.id;
  }

  const canPin = user.role === "ADMIN" || user.role === "DEVELOPER";

  await prisma.chatMessage.create({
    data: {
      body,
      scope,
      targetRole,
      recipientId,
      senderId: user.id,
      senderName: user.name,
      senderRole: user.role,
      isPinned: canPin ? Boolean(data.isPinned) : false,
      reads: {
        create: { userId: user.id },
      },
    },
  });

  revalidatePath("/zangochap-manager/chat");
  return { success: true };
}

export async function markChatMessagesRead(messageIds: string[]) {
  const user = await requireChatSession();
  const uniqueIds = Array.from(new Set(messageIds)).filter(Boolean).slice(0, 200);
  if (uniqueIds.length === 0) return { success: true };

  const visibleMessages = await prisma.chatMessage.findMany({
    where: {
      id: { in: uniqueIds },
      ...visibleMessageWhere(user.id, user.role),
    },
    select: { id: true },
  });

  await prisma.chatRead.createMany({
    data: visibleMessages.map((message) => ({
      messageId: message.id,
      userId: user.id,
    })),
    skipDuplicates: true,
  });

  revalidatePath("/zangochap-manager/chat");
  return { success: true };
}

export async function deleteChatMessage(messageId: string) {
  const user = await requireChatSession();
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { senderId: true },
  });

  if (!message) throw new Error("Message introuvable.");
  const canDelete = message.senderId === user.id || user.role === "ADMIN" || user.role === "DEVELOPER";
  if (!canDelete) throw new Error("Action non autorisee.");

  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/zangochap-manager/chat");
  return { success: true };
}
