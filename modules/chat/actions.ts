"use server";

import { revalidatePath } from "next/cache";
import type { ChatMessageScope, Prisma, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import { emitRiderAlert } from "@/lib/rider-alert-events";

const STAFF_ROLES = ["DEVELOPER", "ADMIN", "COMPTABLE", "COMMERCIAL", "PACKING", "COLLECTION", "STOCK", "LIVREUR"] as const;

export type ChatRoomKey = "GENERAL" | "ROLE" | "DIRECT";

export type ChatMessageView = {
  id: string;
  body: string;
  scope: ChatMessageScope;
  targetRole: Role | null;
  recipientId: string | null;
  senderId: string | null;
  senderName: string;
  senderPhone: string | null;
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
  isPaused: boolean;
  pauseReason: string | null;
};

export type ChatSnapshot = {
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: Role;
    isPaused: boolean;
    pauseReason: string | null;
  };
  users: ChatUserView[];
  messages: ChatMessageView[];
  unreadCount: number;
};

export type RiderMessageAlertView = {
  id: string;
  body: string;
  senderName: string;
  senderPhone: string | null;
  createdAt: string;
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

  const [currentUserRecord, users, messages, unreadCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        isPaused: true,
        pauseReason: true,
      },
    }),
    prisma.user.findMany({
      where: {
        role: { in: [...STAFF_ROLES] as unknown as Role[] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        initials: true,
        isPaused: true,
        pauseReason: true,
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
        sender: {
          select: { phone: true },
        },
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
    currentUser: {
      ...user,
      isPaused: Boolean(currentUserRecord?.isPaused),
      pauseReason: currentUserRecord?.pauseReason || null,
    },
    users,
    messages: messages.reverse().map((message) => ({
      id: message.id,
      body: message.body,
      scope: message.scope,
      targetRole: message.targetRole,
      recipientId: message.recipientId,
      senderId: message.senderId,
      senderName: message.senderName,
      senderPhone: message.sender?.phone || null,
      senderRole: message.senderRole,
      isPinned: message.isPinned,
      createdAt: message.createdAt.toISOString(),
      readByMe: message.senderId === user.id || message.reads.length > 0,
    })),
    unreadCount,
  };
}

export async function getLatestUnreadRiderMessage(): Promise<RiderMessageAlertView | null> {
  const user = await requireChatSession();

  const message = await prisma.chatMessage.findFirst({
    where: {
      ...visibleMessageWhere(user.id, user.role),
      senderRole: "LIVREUR",
      senderId: { not: user.id },
      reads: { none: { userId: user.id } },
    },
    select: {
      id: true,
      body: true,
      senderName: true,
      sender: {
        select: { phone: true },
      },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!message) return null;

  return {
    id: message.id,
    body: message.body,
    senderName: message.senderName,
    senderPhone: message.sender?.phone || null,
    createdAt: message.createdAt.toISOString(),
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
      select: { id: true, role: true, isPaused: true },
    });
    if (!recipient) throw new Error("Destinataire introuvable.");
    ensureStaffRole(recipient.role);
    if (user.role === "LIVREUR" && recipient.role === "COMMERCIAL" && recipient.isPaused) {
      throw new Error("Ce commercial est actuellement en pause.");
    }
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

export async function toggleCommercialPause(isPaused: boolean, reason?: string) {
  const user = await requireChatSession();
  if (user.role !== "COMMERCIAL" && user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    throw new Error("Action reservee aux commerciaux.");
  }

  const pauseReason = reason?.trim().slice(0, 160) || null;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      isPaused,
      pausedAt: isPaused ? new Date() : null,
      pauseReason: isPaused ? pauseReason : null,
    },
  });

  revalidatePath("/zangochap-manager/chat");
  return { success: true, isPaused, pauseReason: isPaused ? pauseReason : null };
}

export async function getCurrentCommercialPauseStatus() {
  const user = await requireChatSession();
  if (user.role !== "COMMERCIAL") {
    return { canPause: false, isPaused: false, pauseReason: null };
  }

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      isPaused: true,
      pauseReason: true,
    },
  });

  return {
    canPause: true,
    isPaused: Boolean(record?.isPaused),
    pauseReason: record?.pauseReason || null,
  };
}

export async function recordCommercialContactReport(data: {
  orderRef?: string;
  orderId?: string;
  outcome: string;
  report: string;
}) {
  const user = await requireChatSession();
  if (user.role !== "COMMERCIAL" && user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    throw new Error("Action reservee au call center.");
  }

  const outcome = data.outcome.trim();
  const report = data.report.trim();
  if (!outcome) throw new Error("Choisissez un resultat.");
  if (!report) throw new Error("Ajoutez un mini rapport.");
  if (report.length > 800) throw new Error("Rapport trop long.");

  const orderWhere = data.orderId
    ? { id: data.orderId }
    : data.orderRef
      ? { ref: data.orderRef }
      : null;
  if (!orderWhere) throw new Error("Commande introuvable dans l'alerte.");

  const order = await prisma.order.findUnique({
    where: orderWhere as Prisma.OrderWhereUniqueInput,
    select: {
      id: true,
      ref: true,
      history: true,
      commercialId: true,
    },
  });
  if (!order) throw new Error("Commande introuvable.");
  if (user.role === "COMMERCIAL" && order.commercialId && order.commercialId !== user.id) {
    throw new Error("Cette commande appartient a un autre commercial.");
  }

  const history: Prisma.InputJsonValue[] = Array.isArray(order.history)
    ? [...(order.history as Prisma.InputJsonValue[])]
    : [];
  const nextHistory = [
    ...history,
    {
      at: new Date().toISOString(),
      action: `Retour call center: ${outcome} - ${report}`,
      by: user.email,
      byName: user.name,
    },
  ] as Prisma.InputJsonValue;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      isCommercialContacted: true,
      commercialContactedAt: new Date(),
      commercialContactedByName: user.name,
      commercialContactOutcome: outcome,
      commercialContactReport: report,
      history: nextHistory,
    },
  });

  revalidatePath("/zangochap-manager/chat");
  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  return { success: true };
}

export async function acceptOrderAfterCommercialIntervention(data: {
  orderRef?: string;
  orderId?: string;
  report?: string;
}) {
  const user = await requireChatSession();
  if (user.role !== "COMMERCIAL" && user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    throw new Error("Action reservee au call center.");
  }

  const report = data.report?.trim().slice(0, 800)
    || "Client disponible, livraison confirmee apres intervention commerciale.";
  const orderWhere = data.orderId
    ? { id: data.orderId }
    : data.orderRef
      ? { ref: data.orderRef }
      : null;
  if (!orderWhere) throw new Error("Commande introuvable dans l'alerte.");

  const order = await prisma.order.findUnique({
    where: orderWhere as Prisma.OrderWhereUniqueInput,
    select: {
      id: true,
      ref: true,
      history: true,
      status: true,
      commercialId: true,
      deliverymanId: true,
      deliverymanName: true,
      commercialContactOutcome: true,
    },
  });
  if (!order) throw new Error("Commande introuvable.");
  if (user.role === "COMMERCIAL" && order.commercialId && order.commercialId !== user.id) {
    throw new Error("Cette commande appartient a un autre commercial.");
  }
  if (!order.deliverymanId) throw new Error("Aucun livreur n'est assigne a cette commande.");
  if (["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED"].includes(order.status)) {
    throw new Error("Cette commande est deja cloturee.");
  }

  const acceptedOutcome = "Client disponible - livraison confirmee";
  if (order.commercialContactOutcome === acceptedOutcome) {
    return { success: true, alreadyAccepted: true };
  }

  const now = new Date();
  const history: Prisma.InputJsonValue[] = Array.isArray(order.history)
    ? [...(order.history as Prisma.InputJsonValue[])]
    : [];
  const nextHistory = [
    ...history,
    {
      at: now.toISOString(),
      action: `Colis accepte apres intervention commerciale: ${report}`,
      by: user.email,
      byName: user.name,
    },
  ] as Prisma.InputJsonValue;
  const notificationBody = [
    `[CONFIRMATION COMMERCIALE] Commande ${order.ref || order.id}`,
    "Client disponible, livraison confirmee.",
    `Intervention: ${user.name}`,
    `Rapport: ${report}`,
  ].join("\n");

  const notification = await prisma.$transaction(async (tx) => {
    const accepted = await tx.order.updateMany({
      where: {
        id: order.id,
        OR: [
          { commercialContactOutcome: null },
          { commercialContactOutcome: { not: acceptedOutcome } },
        ],
      },
      data: {
        isCommercialContacted: true,
        commercialContactedAt: now,
        commercialContactedByName: user.name,
        commercialContactOutcome: acceptedOutcome,
        commercialContactReport: report,
        history: nextHistory,
      },
    });
    if (accepted.count === 0) return null;

    return tx.chatMessage.create({
      data: {
        body: notificationBody,
        scope: "DIRECT",
        recipientId: order.deliverymanId,
        senderId: user.id,
        senderName: user.name,
        senderRole: user.role,
        reads: { create: { userId: user.id } },
      },
    });
  });

  if (!notification) return { success: true, alreadyAccepted: true };

  emitRiderAlert({
    id: notification.id,
    body: notification.body,
    senderName: user.name,
    senderPhone: null,
    createdAt: notification.createdAt.toISOString(),
    scope: "DIRECT",
    targetRole: null,
    recipientId: order.deliverymanId,
  });

  revalidatePath("/zangochap-manager/chat");
  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-rider");
  return {
    success: true,
    alreadyAccepted: false,
    deliverymanName: order.deliverymanName || "le livreur",
  };
}

export async function sendOrderSupportAlert(data: {
  orderId: string;
  reason: string;
  details?: string;
}) {
  const user = await requireChatSession();
  if (user.role !== "LIVREUR" && user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    throw new Error("Action reservee aux livreurs.");
  }

  const reason = data.reason.trim();
  const details = data.details?.trim();
  if (!reason) throw new Error("Choisissez un motif.");
  if (reason.length > 120) throw new Error("Motif trop long.");
  if (details && details.length > 500) throw new Error("Message trop long.");

  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: {
      id: true,
      ref: true,
      customerName: true,
      customerPhone: true,
      customerLocation: true,
      commune: true,
      deliverymanId: true,
      deliverymanName: true,
      commercialId: true,
      commercialName: true,
      status: true,
      total: true,
      deliveryFee: true,
      discount: true,
      history: true,
    },
  });
  if (!order) throw new Error("Commande introuvable.");

  const canAlert =
    user.role === "ADMIN" ||
    user.role === "DEVELOPER" ||
    order.deliverymanId === user.id;
  if (!canAlert) throw new Error("Acces refuse pour cette commande.");

  const sender = await prisma.user.findUnique({
    where: { id: user.id },
    select: { phone: true },
  });
  const riderPhone = sender?.phone || null;
  const amount = Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0);
  const body = [
    `[ALERTE LIVREUR] Commande ${order.ref || order.id}`,
    `Motif: ${reason}`,
    `Livreur: ${order.deliverymanName || user.name}`,
    riderPhone ? `Telephone livreur: ${riderPhone}` : null,
    `Client: ${order.customerName} - ${order.customerPhone}`,
    `Commune: ${order.commune || "Non definie"}`,
    `Adresse: ${order.customerLocation || "Non renseignee"}`,
    `Statut: ${order.status}`,
    `Montant: ${amount} F`,
    details ? `Message: ${details}` : null,
  ].filter(Boolean).join("\n");

  const commercial = order.commercialId
    ? await prisma.user.findUnique({
      where: { id: order.commercialId },
      select: {
        id: true,
        name: true,
        isPaused: true,
        pauseReason: true,
      },
    })
    : null;
  const isDirectCommercialPaused = Boolean(commercial?.isPaused);
  const alertScope = order.commercialId && !isDirectCommercialPaused ? "DIRECT" : "ROLE";
  const alertTargetRole = alertScope === "ROLE" ? "COMMERCIAL" : null;
  const alertRecipientId = alertScope === "DIRECT" ? order.commercialId : null;
  const excludedRecipientIds = isDirectCommercialPaused && commercial?.id ? [commercial.id] : [];
  const pauseNotice = isDirectCommercialPaused
    ? `\n\n[INFO] ${commercial?.name || order.commercialName || "Le commercial"} est en pause${commercial?.pauseReason ? ` (${commercial.pauseReason})` : ""}. Alerte relayee au call center actif.`
    : "";
  const finalBody = `${body}${pauseNotice}`;

  const chatMessage = await prisma.chatMessage.create({
    data: {
      body: finalBody,
      scope: alertScope,
      targetRole: alertTargetRole,
      recipientId: alertRecipientId,
      senderId: user.id,
      senderName: user.name,
      senderRole: user.role,
      reads: {
        create: { userId: user.id },
      },
    },
  });

  emitRiderAlert({
    id: chatMessage.id,
    body: finalBody,
    senderName: user.name,
    senderPhone: riderPhone,
    createdAt: chatMessage.createdAt.toISOString(),
    scope: alertScope,
    targetRole: alertTargetRole,
    recipientId: alertRecipientId,
    excludedRecipientIds,
  });

  const history: Prisma.InputJsonValue[] = Array.isArray(order.history)
    ? [...(order.history as Prisma.InputJsonValue[])]
    : [];
  const nextHistory = [
    ...history,
    {
      at: new Date().toISOString(),
      action: `Alerte call center: ${reason}${order.commercialName ? ` (${order.commercialName})` : ""}${isDirectCommercialPaused ? " - commercial en pause, relais groupe" : ""}`,
      by: user.email,
      byName: user.name,
    },
  ] as Prisma.InputJsonValue;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      history: nextHistory,
    },
  });

  revalidatePath("/zangochap-manager/chat");
  revalidatePath("/zangochap-rider");
  return {
    success: true,
    target: isDirectCommercialPaused
      ? `Call center actif (${commercial?.name || order.commercialName || "commercial"} en pause)`
      : order.commercialName || "Call center",
  };
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
