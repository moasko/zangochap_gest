import type { NextRequest } from "next/server";

import { loginCustomer, loginSchema } from "@/modules/mobile-api/customer";
import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "auth-login", 10, 15 * 60_000);
    return json(await loginCustomer(loginSchema.parse(await request.json())));
  });
}
