import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { getSession } from "@/modules/auth/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user || !["ADMIN", "DEVELOPER"].includes(user.role.toUpperCase())) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  // LISTEN needs a session connection, not a transaction-mode pooler.
  const connectionString = process.env.RIDER_STREAM_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return NextResponse.json({ error: "Flux indisponible." }, { status: 503 });
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let finish: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat); clearTimeout(lifetime);
        req.signal.removeEventListener("abort", finish);
        void client.end().catch(() => {});
        try { controller.close(); } catch { /* The consumer may already have cancelled. */ }
      };
      const send = (event: string) => {
        if (closed) return;
        // A slow consumer reconnects and loads the current snapshot instead of accumulating events.
        if (controller.desiredSize !== null && controller.desiredSize < -4) { finish(); return; }
        try { controller.enqueue(encoder.encode("retry: 1000\nevent: " + event + "\ndata: {}\n\n")); } catch { finish(); }
      };
      client.on("error", finish);
      client.on("end", finish);
      client.on("notification", message => { if (message.channel === "rider_tracking_changed") send("change"); });
      req.signal.addEventListener("abort", finish, { once: true });
      if (req.signal.aborted) { finish(); return; }
      // Reconnect regularly to recheck the cookie and current role. No GPS data is sent in notifications.
      lifetime = setTimeout(finish, 55000);
      void (async () => {
        try {
          await client.connect();
          if (closed) return;
          await client.query("LISTEN rider_tracking_changed");
          if (closed) return;
          send("ready");
          heartbeat = setInterval(() => send("heartbeat"), 15000);
        } catch { finish(); }
      })();
    },
    cancel() { finish(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no", "Connection": "keep-alive",
  } });
}
