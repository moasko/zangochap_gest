"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { getWhatsAppConfigurationStatus, getWhatsAppServerConfig } from "./config";

const WHATSAPP_PATH = "/zangochap-manager/admin/whatsapp";
const SENT_LOG_KEY = "whatsapp:sent-log";
const WEBHOOK_LOG_KEY = "whatsapp:webhook-log";
// Journal glissant en CmsContent (pas de migration) : on garde les N derniers evenements.
const LOG_LIMIT = 100;

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
  }),
]);

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function getWebhookUrl(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) return "/api/webhooks/whatsapp";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}/api/webhooks/whatsapp`;
}

async function requireWhatsAppAdmin() {
  return ensureAuth(["admin", "developer"]);
}

type GraphResult = { ok: boolean; status: number; result: Record<string, any> };

async function graphFetch(path: string, init?: RequestInit): Promise<GraphResult> {
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

function graphErrorMessage(graph: GraphResult, fallback: string) {
  return graph.result?.error?.message || `${fallback} (${graph.status || "réseau"}).`;
}

async function readLog(key: string) {
  const row = await prisma.cmsContent.findUnique({ where: { key } });
  return Array.isArray(row?.data) ? (row!.data as Prisma.JsonArray) : [];
}

async function appendLog(key: string, entry: Record<string, unknown>, updatedBy?: string) {
  const list = await readLog(key);
  const data = [entry, ...list].slice(0, LOG_LIMIT) as Prisma.InputJsonArray;
  await prisma.cmsContent.upsert({
    where: { key },
    update: { data, updatedBy },
    create: { key, data, updatedBy },
  });
}

export async function getWhatsAppConsoleData() {
  await requireWhatsAppAdmin();
  const config = getWhatsAppServerConfig();
  const [requestHeaders, sentLog, webhookLog] = await Promise.all([
    headers(),
    readLog(SENT_LOG_KEY),
    readLog(WEBHOOK_LOG_KEY),
  ]);

  return {
    configuration: getWhatsAppConfigurationStatus(config),
    webhookUrl: getWebhookUrl(requestHeaders),
    sentLog,
    webhookLog,
  };
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

  const recipient = normalizePhone(parsed.data.recipient);
  if (!/^\d{8,15}$/.test(recipient)) {
    return { success: false as const, error: "Utilisez le format international sans espaces, par exemple 2250700000000." };
  }

  const data = parsed.data;
  const payload = data.mode === "template"
    ? {
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
    }
    : {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body: data.message },
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
    templateName: data.mode === "template" ? data.templateName : null,
    preview: data.mode === "text" ? data.message.slice(0, 120) : null,
    status: graph.ok ? "sent" : "failed",
    error: graph.ok ? null : graphErrorMessage(graph, "Meta a refusé la requête"),
    messageId: messageId ? messageId.slice(-20) : null,
  };
  await appendLog(SENT_LOG_KEY, logEntry, session.email);
  revalidatePath(WHATSAPP_PATH);

  if (!graph.ok) {
    return { success: false as const, error: logEntry.error as string };
  }
  return { success: true as const, messageId };
}
