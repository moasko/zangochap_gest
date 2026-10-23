import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { registerPushSchema } from "@/modules/mobile-api/push";
import { registerDevice } from "@/modules/push/engine";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "push-register", 30, 10 * 60_000);
    const input = registerPushSchema.parse(await request.json());
    return json(await registerDevice(input));
  });
}
