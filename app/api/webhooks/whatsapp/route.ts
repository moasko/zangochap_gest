import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getWhatsAppServerConfig } from "@/modules/whatsapp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function maskIdentifier(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return text ? `***${text.slice(-6)}` : null;
}

function summarizeWebhook(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const summaries: Prisma.InputJsonObject[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = Array.isArray((entry as Record<string, unknown>).changes)
      ? (entry as Record<string, unknown>).changes as unknown[]
      : [];

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const content = value as Record<string, unknown>;

      for (const message of Array.isArray(content.messages) ? content.messages : []) {
        if (!message || typeof message !== "object") continue;
        const item = message as Record<string, unknown>;
        summaries.push({
          direction: "incoming",
          from: maskIdentifier(item.from),
          messageId: maskIdentifier(item.id),
          type: typeof item.type === "string" ? item.type : "unknown",
        });
      }

      for (const status of Array.isArray(content.statuses) ? content.statuses : []) {
        if (!status || typeof status !== "object") continue;
        const item = status as Record<string, unknown>;
        summaries.push({
          direction: "status",
          messageId: maskIdentifier(item.id),
          recipient: maskIdentifier(item.recipient_id),
          status: typeof item.status === "string" ? item.status : "unknown",
        });
      }
    }
  }

  return summaries.slice(0, 20);
}

export async function GET(request: NextRequest) {
  const config = getWhatsAppServerConfig();
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (config.verifyToken && mode === "subscribe" && token === config.verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return NextResponse.json({ error: "Webhook non vérifié." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const config = getWhatsAppServerConfig();
  if (!config.appSecret) {
    return NextResponse.json({ error: "WHATSAPP_APP_SECRET manquant." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const events = summarizeWebhook(payload);
  const webhookData: Prisma.InputJsonObject = { at: new Date().toISOString(), events };
  await prisma.cmsContent.upsert({
    where: { key: "whatsapp:last-webhook" },
    update: { data: webhookData },
    create: { key: "whatsapp:last-webhook", data: webhookData },
  });

  return NextResponse.json({ received: true });
}
