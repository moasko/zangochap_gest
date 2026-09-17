"use server";

import { randomUUID } from "node:crypto";
import { Role, type Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { uploadImage } from "@/lib/upload";
import { createOrderWithContext } from "./order-creation-service";
import { generateUniqueRef } from "../helpers";
import { notifyOrderCreatedWhatsApp } from "@/modules/whatsapp/send";
import { triggerAutomations } from "@/modules/automations/engine";
import {
  REPROGRAMMING_PREFIX, ReprogramOrderSchema, ReproDispoSchema,
  parseReprogrammingDate, type ReprogrammingRequest,
} from "../types/reprogramming";

function refreshRequests() {
  for (const path of ["/zangochap-manager/orders", "/zangochap-manager/orders/reprogramming", "/zangochap-manager/dashboard", "/zangochap-manager/chat", "/zangochap-manager/logistics/packing", "/zangochap-rider"]) {
    revalidatePath(path);
  }
}

function requestJson(request: ReprogrammingRequest): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(request)) as Prisma.InputJsonObject;
}

export async function getReprogrammingRequests(): Promise<ReprogrammingRequest[]> {
  const session = await ensureAuth(["admin", "commercial"]);
  const rows = await prisma.cmsContent.findMany({
    where: {
      key: { startsWith: REPROGRAMMING_PREFIX },
      ...(session.role === "commercial" ? { data: { path: ["commercialId"], equals: session.id } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(row => row.data as unknown as ReprogrammingRequest);
}

export async function requestOrderReprogramming(orderId: string, input: unknown, kind: "NEW_ORDER" | "REPRO_DISPO" = "NEW_ORDER") {
  const session = await ensureAuth(["commercial"]);
  if (session.role !== "commercial") throw new Error("Cette demande est réservée aux commerciaux.");
  z.string().min(1).max(200).parse(orderId);
  const parsed = kind === "NEW_ORDER" ? ReprogramOrderSchema.safeParse(input)
    : kind === "REPRO_DISPO" ? ReproDispoSchema.safeParse(input) : null;
  if (!parsed?.success) throw new Error(parsed?.error.issues[0]?.message || "Demande invalide.");

  // Slow media uploads happen before the transaction, only after checking ownership.
  const orderPayload = kind === "NEW_ORDER" ? ReprogramOrderSchema.parse(parsed.data) : null;
  if (orderPayload?.items.some(item => item.image?.startsWith("data:image"))) {
    const original = await prisma.order.findUnique({ where: { id: orderId }, select: { commercialId: true, deletedAt: true } });
    if (!original || original.deletedAt || original.commercialId !== session.id) throw new Error("Accès refusé à cette commande.");
    for (const item of orderPayload.items) {
      if (item.image?.startsWith("data:image")) item.image = await uploadImage(item.image, `reprogramming-${randomUUID()}`);
    }
  }

  const request = await prisma.$transaction(async tx => {
    // Serialize requests per original order; uniqueness does not rely on the UI.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt || order.commercialId !== session.id) throw new Error("Accès refusé à cette commande.");
    if (kind === "REPRO_DISPO" && (order.settlementId || ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status))) {
      throw new Error("Cette livraison est déjà clôturée. Une correction administrateur est nécessaire.");
    }
    const pending = await tx.cmsContent.findFirst({ where: {
      key: { startsWith: REPROGRAMMING_PREFIX },
      AND: [{ data: { path: ["orderId"], equals: orderId } }, { data: { path: ["status"], equals: "PENDING" } }],
    } });
    if (pending) throw new Error("Une demande pour cette commande attend déjà la validation administrateur.");

    const saved: ReprogrammingRequest = {
      id: randomUUID(), orderId, orderRef: order.ref || order.id,
      commercialId: session.id, commercialName: session.name,
      createdAt: new Date().toISOString(), originalUpdatedAt: order.updatedAt.toISOString(),
      originalStatus: order.status, originalDeliveryDate: order.deliveryDate?.toISOString() || null,
      kind, status: "PENDING", payload: orderPayload ?? parsed.data,
    };
    await tx.cmsContent.create({ data: { key: `${REPROGRAMMING_PREFIX}${saved.id}`, data: requestJson(saved), updatedBy: session.email } });
    await tx.chatMessage.create({ data: {
      body: `Demande de reprogrammation ${saved.orderRef} par ${session.name}\nDate demandée : ${parsed.data.deliveryDate}\nMotif : ${parsed.data.reason}\nÀ valider : /zangochap-manager/orders/reprogramming`,
      scope: "ROLE", targetRole: Role.ADMIN, senderId: session.id,
      senderName: session.name, senderRole: Role.COMMERCIAL,
    } });
    return saved;
  });
  refreshRequests();
  return { approvalRequired: true as const, request };
}

export async function reviewOrderReprogramming(requestId: string, decision: "APPROVED" | "REJECTED", note = "") {
  const reviewer = await ensureAuth(["admin"]);
  z.string().uuid().parse(requestId);
  z.enum(["APPROVED", "REJECTED"]).parse(decision);
  const reviewNote = z.string().trim().max(2_000).parse(note);
  if (decision === "REJECTED" && !reviewNote) throw new Error("Indiquez le motif du refus.");
  const key = `${REPROGRAMMING_PREFIX}${requestId}`;

  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM "CmsContent" WHERE key = ${key} FOR UPDATE`;
    const row = await tx.cmsContent.findUnique({ where: { key } });
    if (!row) throw new Error("Demande introuvable.");
    const request = row.data as unknown as ReprogrammingRequest;
    if (request.status !== "PENDING") {
      if (request.status === decision) return { request, changed: false, createdOrder: null, changedOrder: null };
      throw new Error("Cette demande a déjà été traitée.");
    }

    let createdOrder = null;
    let changedOrder = null;
    if (decision === "APPROVED") {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${request.orderId} FOR UPDATE`;
      const original = await tx.order.findUnique({ where: { id: request.orderId } });
      if (!original || original.deletedAt) throw new Error("La commande originale n'est plus disponible.");
      if (original.updatedAt.toISOString() !== request.originalUpdatedAt || original.commercialId !== request.commercialId) {
        throw new Error("La commande a changé depuis la demande. Refusez cette demande et demandez au commercial de la refaire.");
      }
      const history = Array.isArray(original.history) ? original.history as Prisma.InputJsonValue[] : [];
      const entry = { at: new Date().toISOString(), by: reviewer.email, byName: reviewer.name,
        action: `Reprogrammation approuvée pour ${request.commercialName} : ${request.payload.reason}` };
      if (request.kind === "NEW_ORDER") {
        const payload = ReprogramOrderSchema.parse(request.payload);
        const commercial = await tx.user.findUnique({ where: { id: request.commercialId } });
        if (!commercial || commercial.role !== Role.COMMERCIAL) throw new Error("Le compte commercial n'est plus disponible.");
        const requester = { ...reviewer, id: commercial.id, email: commercial.email, name: commercial.name, role: "commercial" };
        // Resolve collisions before entering the creation pipeline: a PostgreSQL error aborts the outer transaction.
        const preferredRef = `REPRO${String(original.ref || "").replace(/^REPRO/i, "")}`;
        const ref = original.ref && !await tx.order.findUnique({ where: { ref: preferredRef }, select: { id: true } })
          ? preferredRef : await generateUniqueRef(payload.commune, "Reprogrammé", tx);
        const created = await createOrderWithContext({ ...payload, ref, type: "Reprogrammé", status: "CONFIRMED",
          giftRequestReason: payload.giftRequestReason || payload.reason,
          notes: `REPROGRAMMATION - Commande originale: ${request.orderRef}\nMotif : ${payload.reason}${payload.notes ? `\n---\n${payload.notes}` : ""}` }, requester, tx);
        createdOrder = await tx.order.update({ where: { id: created.order.id }, data: { confirmedByName: reviewer.name }, include: { items: true } });
        request.newOrderId = createdOrder.id;
        request.newOrderRef = createdOrder.ref || createdOrder.id;
        entry.action += ` — Nouvelle commande : ${request.newOrderRef}`;
        await tx.order.update({ where: { id: original.id }, data: { history: [...history, entry] } });
      } else {
        const payload = ReproDispoSchema.parse(request.payload);
        if (original.settlementId || ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"].includes(original.status)) {
          throw new Error("Cette livraison est déjà clôturée.");
        }
        changedOrder = await tx.order.update({ where: { id: original.id }, data: {
          status: "REPRO_DISPO", type: "Repro-dispo", deliveryDate: parseReprogrammingDate(payload.deliveryDate),
          returnReason: payload.reason, lastDeliveryAttemptAt: new Date(),
          lastDeliveryAttemptRiderId: original.deliverymanId, lastDeliveryAttemptRiderName: original.deliverymanName,
          lastDeliveryAttemptStatus: "REPRO_DISPO", lastDeliveryAttemptReason: payload.reason,
          history: [...history, { ...entry, action: `${entry.action} — Report au ${payload.deliveryDate}` }],
        }, include: { items: true } });
      }
    }
    const reviewed: ReprogrammingRequest = { ...request, status: decision, reviewedAt: new Date().toISOString(), reviewedByName: reviewer.name, reviewNote };
    await tx.cmsContent.update({ where: { key }, data: { data: requestJson(reviewed), updatedBy: reviewer.email } });
    const recipient = await tx.user.findUnique({ where: { id: request.commercialId }, select: { id: true } });
    if (recipient) await tx.chatMessage.create({ data: {
      body: `Reprogrammation ${request.orderRef} ${decision === "APPROVED" ? "approuvée" : "refusée"} par ${reviewer.name}.${request.newOrderRef ? ` Nouvelle commande : ${request.newOrderRef}.` : ""}${reviewNote ? `\nMotif : ${reviewNote}` : ""}`,
      scope: "DIRECT", recipientId: request.commercialId, senderId: reviewer.id,
      senderName: reviewer.name, senderRole: reviewer.role === "developer" ? Role.DEVELOPER : Role.ADMIN,
    } });
    return { request: reviewed, changed: true, createdOrder, changedOrder };
  }, { timeout: 30_000 });

  // External effects run only after commit, and never turn an accepted request into a failure.
  if (result.changed) {
    try {
      if (result.createdOrder) {
        await notifyOrderCreatedWhatsApp(result.createdOrder);
        await triggerAutomations({ type: "order.created", order: result.createdOrder });
      }
      if (result.changedOrder) await triggerAutomations({ type: "order.status_changed", order: result.changedOrder,
        fromStatus: result.request.originalStatus, toStatus: "REPRO_DISPO" });
    } catch { /* Approval is committed; notifications are best-effort. */ }
  }
  refreshRequests();
  return result.request;
}
