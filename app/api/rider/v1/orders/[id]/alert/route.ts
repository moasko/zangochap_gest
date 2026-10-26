import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { alertSchema, sendMissionAlert } from "@/modules/rider-app/api";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Alerte au commercial (client injoignable, adresse confuse...). */
export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await sendMissionAlert((await params).id, alertSchema.parse(await request.json()))));
}
