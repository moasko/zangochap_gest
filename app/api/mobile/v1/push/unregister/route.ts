import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { unregisterPushSchema } from "@/modules/mobile-api/push";
import { unregisterDevice } from "@/modules/push/engine";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "push-register", 30, 10 * 60_000);
    const { token } = unregisterPushSchema.parse(await request.json());
    await unregisterDevice(token);
    return json({ ok: true });
  });
}
