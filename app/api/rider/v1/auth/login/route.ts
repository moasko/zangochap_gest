import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { loginRider, riderLoginSchema } from "@/modules/rider-app/auth";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "rider-login", 10, 15 * 60_000);
    return json(await loginRider(riderLoginSchema.parse(await request.json())));
  });
}
