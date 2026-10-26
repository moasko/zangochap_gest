import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { setMissionStatus, statusSchema } from "@/modules/rider-app/api";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Livree, retournee ou reportee (memes regles que l'espace web). */
export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await setMissionStatus((await params).id, statusSchema.parse(await request.json()))));
}
