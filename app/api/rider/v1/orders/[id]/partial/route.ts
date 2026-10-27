import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { partialSchema, setPartialDelivery } from "@/modules/rider-app/api";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await setPartialDelivery((await params).id, partialSchema.parse(await request.json()))));
}
