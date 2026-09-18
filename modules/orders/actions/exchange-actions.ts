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
  EXCHANGE_PREFIX, ExchangeOrderSchema, StoredExchangeRequestSchema, ExchangeCorrectionSchema,
  exchangeValidationMessage, type ExchangeRequest, type ExchangeCorrection,
} from "../types/exchange";
import { logExchangeFailure } from "../helpers/exchange-diagnostics";

function exchangeError(message: string): never {
  const error = new Error(message);
  error.name = "ExchangeValidationError";
  throw error;
}

function refreshRequests() {
  for (const path of ["/zangochap-manager/orders", "/zangochap-manager/orders/exchanges", "/zangochap-manager/dashboard", "/zangochap-manager/chat", "/zangochap-manager/logistics/packing", "/zangochap-rider"]) {
    try { revalidatePath(path); } catch (error) { logExchangeFailure("revalidate-after-commit", error); }
  }
}

function requestJson(request: ExchangeRequest): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(request)) as Prisma.InputJsonObject;
}

export async function getExchangeRequests() {
  const session = await ensureAuth(["admin", "commercial"]);
  const rows = await prisma.cmsContent.findMany({
    where: {
      key: { startsWith: EXCHANGE_PREFIX },
      ...(session.role === "commercial" ? { data: { path: ["commercialId"], equals: session.id } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const requests: ExchangeRequest[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    const parsed = StoredExchangeRequestSchema.safeParse(row.data);
    if (parsed.success && row.key === `${EXCHANGE_PREFIX}${parsed.data.id}`) requests.push(parsed.data);
    else invalidCount++;
  }
  return { requests, invalidCount };
}

export async function requestOrderExchange(orderId: string, input: unknown) {
  const session = await ensureAuth(["commercial"]);
  if (session.role !== "commercial") throw new Error("Cette demande est réservée aux commerciaux.");
  z.string().min(1).max(200).parse(orderId);
  const parsed = ExchangeOrderSchema.safeParse(input);
  if (!parsed.success) {
    const error = new Error(exchangeValidationMessage(parsed.error));
    error.name = "ExchangeValidationError";
    throw error;
  }

  // Slow media uploads happen before the transaction, only after checking ownership.
  const orderPayload = ExchangeOrderSchema.parse(parsed.data);
  if (orderPayload?.items.some(item => item.image?.startsWith("data:image"))) {
    const original = await prisma.order.findUnique({ where: { id: orderId }, select: { commercialId: true, deletedAt: true } });
    if (!original || original.deletedAt || original.commercialId !== session.id) throw new Error("Accès refusé à cette commande.");
    for (const item of orderPayload.items) {
      if (item.image?.startsWith("data:image")) item.image = await uploadImage(item.image, `exchange-${randomUUID()}`);
    }
  }

  const request = await prisma.$transaction(async tx => {
    // Serialize requests per original order; uniqueness does not rely on the UI.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt || order.commercialId !== session.id) throw new Error("Accès refusé à cette commande.");
    const pending = await tx.cmsContent.findFirst({ where: {
      key: { startsWith: EXCHANGE_PREFIX },
      AND: [{ data: { path: ["orderId"], equals: orderId } }, { data: { path: ["status"], equals: "PENDING" } }],
    } });
    if (pending) throw new Error("Une demande pour cette commande attend déjà la validation administrateur.");

    const saved: ExchangeRequest = {
      id: randomUUID(), orderId, orderRef: order.ref || order.id,
      commercialId: session.id, commercialName: session.name,
      createdAt: new Date().toISOString(), originalUpdatedAt: order.updatedAt.toISOString(),
      originalStatus: order.status, originalDeliveryDate: order.deliveryDate?.toISOString() || null,
      kind: "EXCHANGE", status: "PENDING", payload: orderPayload ?? parsed.data,
    };
    await tx.cmsContent.create({ data: { key: `${EXCHANGE_PREFIX}${saved.id}`, data: requestJson(saved), updatedBy: session.email } });
    await tx.chatMessage.create({ data: {
      body: `Demande d’échange ${saved.orderRef} par ${session.name}\nDate demandée : ${parsed.data.deliveryDate}\nMotif : ${parsed.data.exchangeReason}\nÀ valider : /zangochap-manager/orders/exchanges`,
      scope: "ROLE", targetRole: Role.ADMIN, senderId: session.id,
      senderName: session.name, senderRole: Role.COMMERCIAL,
    } });
    return saved;
  });
  refreshRequests();
  return { approvalRequired: true as const, request };
}

export async function reviewOrderExchange(requestId: string, decision: "APPROVED" | "REJECTED", note = "", correction: ExchangeCorrection = {}) {
  const reviewer = await ensureAuth(["admin"]);
  if (!z.string().uuid().safeParse(requestId).success) exchangeError("Identifiant de demande invalide. Actualisez la liste.");
  if (!z.enum(["APPROVED", "REJECTED"]).safeParse(decision).success) exchangeError("Décision invalide : choisissez Approuver ou Refuser.");
  const parsedNote = z.string().trim().max(2_000).safeParse(note);
  if (!parsedNote.success) exchangeError("Commentaire administrateur invalide : saisissez au maximum 2 000 caractères.");
  const reviewNote = parsedNote.data;
  if (decision === "REJECTED" && !reviewNote) throw new Error("Indiquez le motif du refus.");
  const key = `${EXCHANGE_PREFIX}${requestId}`;
  const edits = decision === "APPROVED" ? ExchangeCorrectionSchema.parse(correction) : {};

  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT key FROM "CmsContent" WHERE key = ${key} FOR UPDATE`;
    const row = await tx.cmsContent.findUnique({ where: { key } });
    if (!row) throw new Error("Demande introuvable.");
    const stored = StoredExchangeRequestSchema.safeParse(row.data);
    if (!stored.success) throw new Error(`Les données enregistrées de cette demande sont invalides. ${exchangeValidationMessage(stored.error)}. Faites corriger ou recréer la demande.`);
    if (stored.data.id !== requestId) throw new Error("Les données enregistrées ne correspondent pas à cette demande. Contactez l’administrateur.");
    const request: ExchangeRequest = stored.data;
    if (request.status !== "PENDING") {
      if (request.status === decision) return { request, changed: false, createdOrder: null, changedOrder: null };
      throw new Error(`Cette demande a déjà été traitée : ${request.status === "APPROVED" ? "approuvée" : "refusée"}. Actualisez la liste pour consulter la décision.`);
    }

    let createdOrder = null;
    const changedOrder = null;
    if (decision === "APPROVED") {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${request.orderId} FOR UPDATE`;
      const original = await tx.order.findUnique({ where: { id: request.orderId } });
      if (!original || original.deletedAt) throw new Error("La commande originale n'est plus disponible : elle a été supprimée ou archivée. L’échange ne peut pas être créé.");
      if (original.commercialId !== request.commercialId) exchangeError("La commande a été réattribuée à un autre commercial. Refusez cette demande et faites-la recréer par le propriétaire actuel.");
      if (original.updatedAt.toISOString() !== request.originalUpdatedAt) {
        throw new Error("La commande a changé depuis la demande. Refusez cette demande et demandez au commercial de la refaire.");
      }
      const history = Array.isArray(original.history) ? original.history as Prisma.InputJsonValue[] : [];
      const entry = { at: new Date().toISOString(), by: reviewer.email, byName: reviewer.name,
        action: `Échange approuvé pour ${request.commercialName} : ${request.payload.exchangeReason}` };
      if (request.kind !== "EXCHANGE") throw new Error("Type de demande invalide.");
      {
        const payload = ExchangeOrderSchema.parse({ ...request.payload, ...edits });
        if (payload.deliveryDate !== request.payload.deliveryDate || payload.customerLocation !== request.payload.customerLocation) {
          request.correction = {
            previousDeliveryDate: request.payload.deliveryDate, previousCustomerLocation: request.payload.customerLocation,
            deliveryDate: payload.deliveryDate, customerLocation: payload.customerLocation,
            at: new Date().toISOString(), byName: reviewer.name,
          };
          entry.action += " — Adresse/date corrigée par l’administrateur";
        }
        request.payload = payload;
        const commercial = await tx.user.findUnique({ where: { id: request.commercialId } });
        if (!commercial) throw new Error("Le compte commercial n'est plus disponible : le demandeur a été supprimé.");
        if (commercial.role !== Role.COMMERCIAL) throw new Error("Le compte commercial n'est plus disponible pour cet échange : le demandeur n’a plus le rôle commercial.");
        // Identify removed catalog records before a generic foreign-key error.
        const catalogItems = payload.items.filter(item => !item.isCustom);
        const products = await tx.product.findMany({ where: { id: { in: catalogItems.flatMap(item => item.productId ? [item.productId] : []) } }, select: { id: true } });
        const variants = await tx.productVariant.findMany({ where: { id: { in: catalogItems.flatMap(item => item.variantId ? [item.variantId] : []) } }, select: { id: true, productId: true } });
        for (const [index, item] of payload.items.entries()) {
          if (item.isCustom) continue;
          if (item.productId && !products.some(product => product.id === item.productId)) exchangeError(`Article ${index + 1} : le produit a été supprimé. Refusez la demande et faites sélectionner un produit disponible.`);
          const variant = variants.find(candidate => candidate.id === item.variantId);
          if (item.variantId && !variant) exchangeError(`Article ${index + 1} : la variante a été supprimée. Refaites la demande avec une taille et une couleur disponibles.`);
          if (variant && variant.productId !== item.productId) exchangeError(`Article ${index + 1} : la variante ne correspond pas au produit. Refaites la sélection dans une nouvelle demande.`);
        }
        const requester = { ...reviewer, id: commercial.id, email: commercial.email, name: commercial.name, role: "commercial" };
        // Resolve collisions before entering the creation pipeline: a PostgreSQL error aborts the outer transaction.
        const preferredRef = `ECHANGE${String(original.ref || "").replace(/^ECHANGE/i, "")}`;
        const ref = original.ref && !await tx.order.findUnique({ where: { ref: preferredRef }, select: { id: true } })
          ? preferredRef : await generateUniqueRef(payload.commune, "Echange", tx);
        const created = await createOrderWithContext({ ...payload, ref, type: "Echange", status: "CONFIRMED",
          giftRequestReason: payload.giftRequestReason || payload.exchangeReason,
          notes: `ECHANGE - Commande originale: ${request.orderRef}\nMOTIF ECHANGE: ${payload.exchangeReason}${payload.notes ? `\n---\n${payload.notes}` : ""}` }, requester, tx);
        createdOrder = await tx.order.update({ where: { id: created.order.id }, data: { confirmedByName: reviewer.name }, include: { items: true } });
        request.newOrderId = createdOrder.id;
        request.newOrderRef = createdOrder.ref || createdOrder.id;
        entry.action += ` — Nouvelle commande : ${request.newOrderRef}`;
        await tx.order.update({ where: { id: original.id }, data: { history: [...history, entry] } });
      }
    }
    const reviewed: ExchangeRequest = { ...request, status: decision, reviewedAt: new Date().toISOString(), reviewedByName: reviewer.name, reviewNote };
    await tx.cmsContent.update({ where: { key }, data: { data: requestJson(reviewed), updatedBy: reviewer.email } });
    const recipient = await tx.user.findUnique({ where: { id: request.commercialId }, select: { id: true } });
    if (recipient) await tx.chatMessage.create({ data: {
      body: `Échange ${request.orderRef} ${decision === "APPROVED" ? "approuvé" : "refusé"} par ${reviewer.name}.${request.newOrderRef ? ` Nouvelle commande : ${request.newOrderRef}.` : ""}${reviewNote ? `\nMotif : ${reviewNote}` : ""}`,
      scope: "DIRECT", recipientId: request.commercialId, senderId: reviewer.id,
      senderName: reviewer.name, senderRole: reviewer.role === "developer" ? Role.DEVELOPER : Role.ADMIN,
    } });
    return { request: reviewed, changed: true, createdOrder, changedOrder };
  }, { timeout: 30_000 });

  // External effects run only after commit, and never turn an accepted request into a failure.
  if (result.changed && result.createdOrder) {
    try { await notifyOrderCreatedWhatsApp(result.createdOrder); }
    catch (error) { logExchangeFailure("whatsapp-after-commit", error); }
    try { await triggerAutomations({ type: "order.created", order: result.createdOrder }); }
    catch (error) { logExchangeFailure("automation-after-commit", error); }
  }
  refreshRequests();
  return result.request;
}
