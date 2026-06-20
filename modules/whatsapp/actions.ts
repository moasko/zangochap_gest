"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { getWhatsAppConfigurationStatus, getWhatsAppServerConfig } from "./config";

const SendTestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("template"),
    recipient: z.string().trim().min(8).max(20),
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

function maskPhone(value: string) {
  return value.length <= 4 ? "****" : `${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

function getWebhookUrl(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) return "/api/webhooks/whatsapp";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}/api/webhooks/whatsapp`;
}

export async function getWhatsAppConsoleData() {
  await ensureAuth(["admin"]);
  const config = getWhatsAppServerConfig();
  const [requestHeaders, lastWebhook, lastTest] = await Promise.all([
    headers(),
    prisma.cmsContent.findUnique({ where: { key: "whatsapp:last-webhook" } }),
    prisma.cmsContent.findUnique({ where: { key: "whatsapp:last-test" } }),
  ]);

  return {
    configuration: getWhatsAppConfigurationStatus(config),
    webhookUrl: getWebhookUrl(requestHeaders),
    lastWebhook: lastWebhook?.data || null,
    lastTest: lastTest?.data || null,
  };
}

export async function sendWhatsAppTest(input: unknown) {
  const session = await ensureAuth(["admin"]);
  const parsed = SendTestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Numéro ou message invalide." };
  }

  const config = getWhatsAppServerConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    return {
      success: false as const,
      error: "Ajoutez WHATSAPP_ACCESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID avant le test.",
    };
  }

  const recipient = normalizePhone(parsed.data.recipient);
  if (!/^\d{8,15}$/.test(recipient)) {
    return { success: false as const, error: "Utilisez le format international sans espaces, par exemple 2250700000000." };
  }

  const messagePayload = parsed.data.mode === "template"
    ? {
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: { name: "hello_world", language: { code: "en_US" } },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: parsed.data.message },
      };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messagePayload),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const result = await response.json().catch(() => ({})) as {
      error?: { message?: string };
      messages?: Array<{ id?: string }>;
    };

    if (!response.ok) {
      return {
        success: false as const,
        error: result.error?.message || `Meta a refusé la requête (${response.status}).`,
      };
    }

    await prisma.cmsContent.upsert({
      where: { key: "whatsapp:last-test" },
      update: {
        data: {
          at: new Date().toISOString(),
          byName: session.name,
          messageId: result.messages?.[0]?.id?.slice(-16) || null,
          mode: parsed.data.mode,
          recipient: maskPhone(recipient),
        },
        updatedBy: session.email,
      },
      create: {
        key: "whatsapp:last-test",
        data: {
          at: new Date().toISOString(),
          byName: session.name,
          messageId: result.messages?.[0]?.id?.slice(-16) || null,
          mode: parsed.data.mode,
          recipient: maskPhone(recipient),
        },
        updatedBy: session.email,
      },
    });

    revalidatePath("/zangochap-manager/admin/whatsapp");
    return { success: true as const, messageId: result.messages?.[0]?.id || null };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "La requête Meta a expiré. Réessayez."
      : "Impossible de joindre l’API WhatsApp Cloud.";
    return { success: false as const, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

