"use server";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { uploadImage } from "@/lib/upload";
import { getWhatsAppConfigurationStatus, getWhatsAppServerConfig } from "./config";
import { normalizeIvorianPhone } from "./message-builder";
import {
  SENT_LOG_KEY,
  SETTINGS_KEY,
  WEBHOOK_LOG_KEY,
  appendCmsLog,
  getWhatsAppSettings,
  graphErrorMessage,
  graphFetch,
  readCmsLog,
  sendWhatsAppContent,
} from "./send";

const WHATSAPP_PATH = "/zangochap-manager/admin/whatsapp";

const SendMessageSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("template"),
    recipient: z.string().trim().min(8).max(20),
    templateName: z.string().trim().min(1).max(512),
    language: z.string().trim().min(2).max(15),
    params: z.array(z.string().trim().min(1).max(500)).max(15).optional(),
  }),
  z.object({
    mode: z.literal("text"),
    recipient: z.string().trim().min(8).max(20),
    message: z.string().trim().min(1).max(4096),
    imageUrl: z.string().trim().url().max(1000).optional(),
  }),
]);

function getWebhookUrl(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) return "/api/webhooks/whatsapp";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}/api/webhooks/whatsapp`;
}

async function requireWhatsAppAdmin() {
  return ensureAuth(["admin", "developer"]);
}

export async function getWhatsAppConsoleData() {
  await requireWhatsAppAdmin();
  const config = getWhatsAppServerConfig();
  const [requestHeaders, sentLog, webhookLog, settings] = await Promise.all([
    headers(),
    readCmsLog(SENT_LOG_KEY),
    readCmsLog(WEBHOOK_LOG_KEY),
    getWhatsAppSettings(),
  ]);

  return {
    configuration: getWhatsAppConfigurationStatus(config),
    webhookUrl: getWebhookUrl(requestHeaders),
    sentLog,
    webhookLog,
    settings,
  };
}

// Mise a jour partielle : seuls les champs fournis sont modifies.
export async function updateWhatsAppSettings(input: {
  autoSendOnOrder?: boolean;
  orderTemplate?: string | null;
  orderImageUrl?: string | null;
}) {
  const session = await requireWhatsAppAdmin();
  const current = await getWhatsAppSettings();
  const data = {
    autoSendOnOrder: input.autoSendOnOrder !== undefined ? Boolean(input.autoSendOnOrder) : current.autoSendOnOrder,
    // Chaine vide => retour au modele par defaut (null).
    orderTemplate: input.orderTemplate !== undefined
      ? (input.orderTemplate?.trim() || null)
      : current.orderTemplate,
    orderImageUrl: input.orderImageUrl !== undefined
      ? (input.orderImageUrl?.trim() || null)
      : current.orderImageUrl,
  };
  await prisma.cmsContent.upsert({
    where: { key: SETTINGS_KEY },
    update: { data, updatedBy: session.email },
    create: { key: SETTINGS_KEY, data, updatedBy: session.email },
  });
  revalidatePath(WHATSAPP_PATH);
  return { success: true as const, settings: data };
}

// Diagnostic en direct : etat du numero (qualite, nom verifie) et sante du token
// (type, expiration). Aucun secret ne quitte le serveur.
export async function checkWhatsAppHealth() {
  await requireWhatsAppAdmin();
  const config = getWhatsAppServerConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false as const, error: "Configurez WHATSAPP_ACCESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID d'abord." };
  }

  const [phone, token] = await Promise.all([
    graphFetch(`${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput`),
    graphFetch(`debug_token?input_token=${encodeURIComponent(config.accessToken)}&access_token=${encodeURIComponent(config.accessToken)}`),
  ]);

  if (!phone.ok) {
    return { success: false as const, error: graphErrorMessage(phone, "Impossible de lire le numéro") };
  }

  const tokenData = token.ok ? token.result?.data : null;
  return {
    success: true as const,
    checkedAt: new Date().toISOString(),
    phone: {
      displayPhoneNumber: phone.result.display_phone_number || null,
      verifiedName: phone.result.verified_name || null,
      qualityRating: phone.result.quality_rating || "UNKNOWN",
      codeVerificationStatus: phone.result.code_verification_status || null,
      platformType: phone.result.platform_type || null,
      throughputLevel: phone.result.throughput?.level || null,
    },
    token: tokenData
      ? {
        type: tokenData.type || null,
        isValid: Boolean(tokenData.is_valid),
        // 0 = token permanent (n'expire jamais).
        expiresAt: typeof tokenData.expires_at === "number" && tokenData.expires_at > 0
          ? new Date(tokenData.expires_at * 1000).toISOString()
          : null,
        scopes: Array.isArray(tokenData.scopes) ? tokenData.scopes : [],
      }
      : null,
  };
}

// Liste les templates du compte WABA avec leur statut d'approbation Meta.
export async function getWhatsAppTemplates() {
  await requireWhatsAppAdmin();
  const config = getWhatsAppServerConfig();
  if (!config.accessToken || !config.businessAccountId) {
    return { success: false as const, error: "Configurez WHATSAPP_ACCESS_TOKEN et WHATSAPP_BUSINESS_ACCOUNT_ID d'abord." };
  }

  const graph = await graphFetch(`${config.businessAccountId}/message_templates?fields=name,status,category,language,components&limit=100`);
  if (!graph.ok) {
    return { success: false as const, error: graphErrorMessage(graph, "Impossible de lister les templates") };
  }

  const templates = (Array.isArray(graph.result.data) ? graph.result.data : []).map((template: any) => {
    const body = Array.isArray(template.components)
      ? template.components.find((component: any) => component?.type === "BODY")
      : null;
    const bodyText: string = body?.text || "";
    // Nombre de variables {{n}} attendues par le corps du template.
    const paramCount = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g))
      .reduce((max, match) => Math.max(max, Number(match[1])), 0);
    return {
      name: template.name,
      status: template.status || "UNKNOWN",
      category: template.category || null,
      language: template.language || "fr",
      bodyText,
      paramCount,
    };
  });

  return { success: true as const, templates };
}

export async function sendWhatsAppMessage(input: unknown) {
  const session = await requireWhatsAppAdmin();
  const parsed = SendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Numéro, message ou template invalide." };
  }

  const config = getWhatsAppServerConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false as const, error: "Ajoutez WHATSAPP_ACCESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID avant l'envoi." };
  }

  const recipient = normalizeIvorianPhone(parsed.data.recipient);
  if (!/^\d{8,15}$/.test(recipient)) {
    return { success: false as const, error: "Utilisez le format international sans espaces, par exemple 2250700000000." };
  }

  const data = parsed.data;

  // Le mode texte (avec image optionnelle) passe par le coeur partage,
  // qui gere l'image + legende et journalise l'envoi.
  if (data.mode === "text") {
    const result = await sendWhatsAppContent({
      recipient,
      body: data.message,
      imageUrl: data.imageUrl || null,
      byName: session.name,
    });
    revalidatePath(WHATSAPP_PATH);
    return result;
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: data.templateName,
      language: { code: data.language },
      ...(data.params?.length
        ? { components: [{ type: "body", parameters: data.params.map((text) => ({ type: "text", text })) }] }
        : {}),
    },
  };

  const graph = await graphFetch(`${config.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const messageId: string | null = graph.result?.messages?.[0]?.id || null;
  const logEntry = {
    at: new Date().toISOString(),
    byName: session.name,
    mode: data.mode,
    recipient,
    templateName: data.templateName,
    preview: null,
    status: graph.ok ? "sent" : "failed",
    error: graph.ok ? null : graphErrorMessage(graph, "Meta a refusé la requête"),
    messageId: messageId ? messageId.slice(-20) : null,
  };
  await appendCmsLog(SENT_LOG_KEY, logEntry, session.email);
  revalidatePath(WHATSAPP_PATH);

  if (!graph.ok) {
    return { success: false as const, error: logEntry.error as string };
  }
  return { success: true as const, messageId };
}

// Upload d'un media WhatsApp vers R2 en JPEG (l'API Cloud refuse le WebP pour
// les images). Retourne l'URL publique a joindre aux messages.
export async function uploadWhatsAppMedia(dataUrl: string, fileName: string) {
  await requireWhatsAppAdmin();
  if (!dataUrl?.startsWith("data:image")) {
    return { success: false as const, error: "Fichier invalide : choisissez une image." };
  }
  // ~5 Mo max une fois decode (limite Meta pour les images).
  if (dataUrl.length > 7_000_000) {
    return { success: false as const, error: "Image trop lourde (5 Mo maximum)." };
  }
  try {
    const url = await uploadImage(dataUrl, fileName || "whatsapp-media", { format: "jpeg" });
    return { success: true as const, url };
  } catch (error: any) {
    return { success: false as const, error: error?.message || "Upload impossible." };
  }
}
