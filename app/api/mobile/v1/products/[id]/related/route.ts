import type { NextRequest } from "next/server";

import { getRelated } from "@/modules/mobile-api/catalog";
import { handle, intParam, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    return json(await getRelated(decodeURIComponent(id), intParam(request.nextUrl.searchParams.get("limit")) ?? 8), { cache: 60 });
  });
}
