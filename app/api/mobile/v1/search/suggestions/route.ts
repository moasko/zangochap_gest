import type { NextRequest } from "next/server";

import { getSuggestions } from "@/modules/mobile-api/catalog";
import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(request: NextRequest) {
  return handle(async () => {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (q.length < 2) return json({ products: [], categories: [] });
    return json(await getSuggestions(q), { cache: 30 });
  });
}
