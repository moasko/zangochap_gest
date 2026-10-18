import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { trackOrder } from "@/modules/mobile-api/orders";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    rateLimit(request, "track", 60, 10 * 60_000);
    const { id } = await params;
    return json(await trackOrder(decodeURIComponent(id), request.nextUrl.searchParams.get("phone") ?? ""));
  });
}
