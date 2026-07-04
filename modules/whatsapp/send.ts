// Coeur d'envoi WhatsApp cote serveur, partage entre la console admin
// (actions.ts) et le flux commandes (confirmation auto + envoi manuel).
// Ce fichier n'est PAS un module "use server" : il est importe par du code serveur.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getWhatsAppServerConfig } from "./config";
import { buildOrderWhatsAppMessage, normalizeIvorianPhone } from "./message-builder";

export const SENT_LOG_KEY = "whatsapp:sent-log";
export const WEBHOOK_LOG_KEY = "whatsapp:webhook-log";
export const SETTINGS_KEY = "whatsapp:settings";
// Journal glissant en CmsContent (pas de migration) : on garde les N derniers evenements.
export const LOG_LIMIT = 100;

export type GraphResult = { ok: boolean; status: number; result: Record<string, any> };

export async function graphFetch(path: string, init?: RequestInit): Promise<GraphResult> {
  const config = getWhatsAppServerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, result };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "La requête Meta a expiré."
      : "Impossible de joindre l'API WhatsApp Cloud.";
    return { ok: false, status: 0, result: { error: { message } } };
  } finally {
    clearTimeout(timeout);
  }
}

export function graphErrorMessage(graph: GraphResult, fallback: string) {
  return graph.result?.error?.message || `${fallback} (${graph.status || "réseau"}).`;
}

export async function readCmsLog(key: string) {
  const row = await prisma.cmsContent.findUnique({ where: { key } });
  return Array.isArray(row?.data) ? (row.data as Prisma.JsonArray) : [];
}

export async function appendCmsLog(key: string, entry: Record<string, unknown>, updatedBy?: string) {
  const list = await readCmsLog(key);
  const data = [entry, ...list].slice(0, LOG_LIMIT) as Prisma.InputJsonArray;
  await prisma.cmsContent.upsert({
    where: { key },
    update: { data, updatedBy },
    create: { key, data, updatedBy },
  });
}

export async function getWhatsAppSettings(): Promise<{
  autoSendOnOrder: boolean;
  orderTemplate: string | null;
  orderImageUrl: string | null;
}> {
  const row = await prisma.cmsContent.findUnique({ where: { key: SETTINGS_KEY } });
  const data = row?.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? row.data as Record<string, unknown>
    : {};
  return {
    autoSendOnOrder: Boolean(data.autoSendOnOrder),
    // Modele personnalise du message de confirmation ; null => modele par defaut.
    orderTemplate: typeof data.orderTemplate === "string" && data.orderTemplate.trim() ? data.orderTemplate : null,
    // Image jointe a la confirmation de commande (URL publique R2), optionnelle.
    orderImageUrl: typeof data.orderImageUrl === "string" && data.orderImageUrl.trim() ? data.orderImageUrl : null,
  };
}

// Envoi d'un texte libre + journalisation (reussite ou echec) dans le log admin.
export async function sendWhatsAppText(input: { recipient: string; body: string; byName?: string | null }) {
  const config = getWhatsAppServerConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false as const, error: "Configuration WhatsApp incomplète (token ou numéro manquant)." };
  }

  const recipient = normalizeIvorianPhone(input.recipient);
  if (!/^\d{8,15}$/.test(recipient)) {
    return { success: false as const, error: "Numéro de téléphone du client invalide." };
  }

  const body = input.body.trim().slice(0, 4096);
  if (!body) return { success: false as const, error: "Message vide." };

  const graph = await graphFetch(`${config.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const messageId: string | null = graph.result?.messages?.[0]?.id || null;
  const error = graph.ok ? null : graphErrorMessage(graph, "Meta a refusé la requête");
  await appendCmsLog(SENT_LOG_KEY, {
    at: new Date().toISOString(),
    byName: input.byName || "Système",
    mode: "text",
    recipient,
    templateName: null,
    preview: body.slice(0, 120),
    status: graph.ok ? "sent" : "failed",
    error,
    messageId: messageId ? messageId.slice(-20) : null,
  });

  if (!graph.ok) return { success: false as const, error: error as string };
  return { success: true as const, messageId };
}

// Envoi d'une image (URL publique HTTPS, JPEG/PNG) avec legende optionnelle.
// Limite Meta : legende de 1024 caracteres maximum.
export async function sendWhatsAppImage(input: {
  recipient: string;
  imageUrl: string;
  caption?: string | null;
  byName?: string | null;
}) {
  const config = getWhatsAppServerConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false as const, error: "Configuration WhatsApp incomplète (token ou numéro manquant)." };
  }

  const recipient = normalizeIvorianPhone(input.recipient);
  if (!/^\d{8,15}$/.test(recipient)) {
    return { success: false as const, error: "Numéro de téléphone du client invalide." };
  }
  if (!/^https:\/\//.test(input.imageUrl)) {
    return { success: false as const, error: "L'image doit être une URL publique en HTTPS." };
  }

  const caption = input.caption?.trim().slice(0, 1024) || "";
  const graph = await graphFetch(`${config.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "image",
      image: { link: input.imageUrl, ...(caption ? { caption } : {}) },
    }),
  });

  const messageId: string | null = graph.result?.messages?.[0]?.id || null;
  const error = graph.ok ? null : graphErrorMessage(graph, "Meta a refusé la requête");
  await appendCmsLog(SENT_LOG_KEY, {
    at: new Date().toISOString(),
    byName: input.byName || "Système",
    mode: "image",
    recipient,
    templateName: null,
    preview: caption ? caption.slice(0, 120) : null,
    imageUrl: input.imageUrl,
    status: graph.ok ? "sent" : "failed",
    error,
    messageId: messageId ? messageId.slice(-20) : null,
  });

  if (!graph.ok) return { success: false as const, error: error as string };
  return { success: true as const, messageId };
}

// Envoi "contenu" : texte seul, image avec legende, ou image PUIS texte quand le
// message depasse la limite de legende (1024 caracteres).
export async function sendWhatsAppContent(input: {
  recipient: string;
  body?: string | null;
  imageUrl?: string | null;
  byName?: string | null;
}) {
  const body = input.body?.trim() || "";
  if (input.imageUrl) {
    if (body && body.length <= 1024) {
      return sendWhatsAppImage({ recipient: input.recipient, imageUrl: input.imageUrl, caption: body, byName: input.byName });
    }
    const image = await sendWhatsAppImage({ recipient: input.recipient, imageUrl: input.imageUrl, byName: input.byName });
    if (!image.success || !body) return image;
    return sendWhatsAppText({ recipient: input.recipient, body, byName: input.byName });
  }
  if (!body) return { success: false as const, error: "Message vide." };
  return sendWhatsAppText({ recipient: input.recipient, body, byName: input.byName });
}

// Trace dans l'historique de la commande (meme format que addOrderHistoryEntry).
export async function appendOrderHistory(orderId: string, action: string, by?: string | null, byName?: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { history: true } });
  if (!order) return;
  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({ at: new Date().toISOString(), action, by: by || "system", byName: byName || "Système" });
  await prisma.order.update({ where: { id: orderId }, data: { history } });
}

// Confirmation automatique apres prise de commande (si activee dans la console
// admin). Volontairement HORS module "use server" pour ne pas etre exposee comme
// endpoint public. Best-effort : ne doit JAMAIS faire echouer la creation.
export async function notifyOrderCreatedWhatsApp(order: {
  id: string;
  customerPhone?: string | null;
}) {
  try {
    const settings = await getWhatsAppSettings();
    if (!settings.autoSendOnOrder || !order.customerPhone) return;

    // Recharge la commande avec ses articles pour composer le recapitulatif.
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    if (!fullOrder) return;

    const result = await sendWhatsAppContent({
      recipient: fullOrder.customerPhone,
      body: buildOrderWhatsAppMessage(fullOrder, settings.orderTemplate),
      imageUrl: settings.orderImageUrl,
      byName: "Auto (prise de commande)",
    });

    await appendOrderHistory(
      order.id,
      result.success
        ? "Confirmation WhatsApp envoyée automatiquement au client"
        : `Échec de la confirmation WhatsApp automatique : ${result.error}`,
    );
  } catch {
    // Silencieux volontairement : la commande prime sur la notification.
  }
}
