import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";
import { addMissionNote, noteSchema } from "@/modules/rider-app/tour";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Trace de tournee dans l'historique (« en route », appels sans reponse). */
export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const rider = await requireRider();
    return json(await addMissionNote(rider, (await params).id, noteSchema.parse(await request.json())));
  });
}
