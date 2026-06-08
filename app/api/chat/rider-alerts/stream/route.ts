import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getSession } from "@/modules/auth/actions";
import { canReceiveRiderAlert, subscribeToRiderAlerts } from "@/lib/rider-alert-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAFF_ROLES = ["DEVELOPER", "ADMIN", "COMMERCIAL", "PACKING", "COLLECTION", "STOCK", "LIVREUR"] as const;

function sendEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function GET() {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: "Non authentifie" }, { status: 401 });

  const role = String(session.role || "").toUpperCase() as Role;
  if (!STAFF_ROLES.includes(role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
  }

  const user = { id: String(session.id), role };

  let unsubscribe: () => void = () => undefined;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sendEvent(controller, "ready", { ok: true });

      unsubscribe = subscribeToRiderAlerts((alert) => {
        if (!canReceiveRiderAlert(alert, user)) return;
        sendEvent(controller, "rider-alert", alert);
      });

      keepAlive = setInterval(() => {
        sendEvent(controller, "ping", { at: Date.now() });
      }, 25_000);
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
