import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { createMobileOrder, createOrderSchema } from "@/modules/mobile-api/orders";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest) {
  return handle(async () => {
    const body = await request.json();
    const input = createOrderSchema.parse({ ...body, idempotencyKey: request.headers.get("idempotency-key") || body?.idempotencyKey });
    rateLimit(request, "orders", 8, 10 * 60_000);
    return json(await createMobileOrder(input), { status: 201 });
  });
}
