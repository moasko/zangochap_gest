import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { cartValidationSchema, validateCart } from "@/modules/mobile-api/orders";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "cart", 60, 10 * 60_000);
    return json(await validateCart(cartValidationSchema.parse(await request.json())));
  });
}
