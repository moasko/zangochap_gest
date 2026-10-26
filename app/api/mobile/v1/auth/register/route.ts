import type { NextRequest } from "next/server";

import { registerCustomer, registerSchema } from "@/modules/mobile-api/customer";
import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "auth-register", 5, 30 * 60_000);
    return json(await registerCustomer(registerSchema.parse(await request.json())), { status: 201 });
  });
}
