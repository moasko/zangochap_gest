"use server";


import { Role, type Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";

import {
  REPROGRAMMING_PREFIX,
  type ReprogrammingRequest,
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

export async function requestOrderReprogramming() {
  await ensureAuth(["commercial"]);
  throw new Error("Les reprogrammations sont désormais directes. Actualisez la page ; seules les demandes d’échange nécessitent une validation.");
}

export async function reviewOrderReprogramming(requestId: string, decision: "APPROVED" | "REJECTED", note = "") {
  const reviewer = await ensureAuth(["admin"]);
  z.string().uuid().parse(requestId);
  z.enum(["APPROVED", "REJECTED"]).parse(decision);
  if (decision === "APPROVED") throw new Error("Les anciennes demandes de reprogrammation ne sont plus approuvables. Refusez la demande puis utilisez la reprogrammation directe.");
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

    const createdOrder = null; const changedOrder = null;
    const reviewed: ReprogrammingRequest = { ...request, status: decision, reviewedAt: new Date().toISOString(), reviewedByName: reviewer.name, reviewNote };
    await tx.cmsContent.update({ where: { key }, data: { data: requestJson(reviewed), updatedBy: reviewer.email } });
    const recipient = await tx.user.findUnique({ where: { id: request.commercialId }, select: { id: true } });
    if (recipient) await tx.chatMessage.create({ data: {
      body: `Reprogrammation ${request.orderRef} refusée par ${reviewer.name}.${request.newOrderRef ? ` Nouvelle commande : ${request.newOrderRef}.` : ""}${reviewNote ? `\nMotif : ${reviewNote}` : ""}`,
      scope: "DIRECT", recipientId: request.commercialId, senderId: reviewer.id,
      senderName: reviewer.name, senderRole: reviewer.role === "developer" ? Role.DEVELOPER : Role.ADMIN,
    } });
    return { request: reviewed, changed: true, createdOrder, changedOrder };
  }, { timeout: 30_000 });

  refreshRequests();
  return result.request;
}
