import type { NextRequest } from "next/server";
import { z } from "zod";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";
import { ingestTracking } from "@/modules/rider-tracking/ingest";
import { trackingInput } from "@/modules/rider-tracking/validation";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

// Lot d'evenements (suivi en arriere-plan, rattrapage apres coupure reseau), dans l'ordre.
const batchSchema = z.object({ events: z.array(trackingInput).min(1).max(200) });

// Au-dela de 12 h, une position n'a plus d'interet pour la carte : ignoree.
const MAX_QUEUED_AGE_MS = 12 * 3600_000;

export function POST(request: NextRequest) {
  return handle(async () => {
    const rider = await requireRider();
    const { events } = batchSchema.parse(await request.json());
    let accepted = 0;
    let stopped = false;
    for (const event of events) {
      if (event.action === "point") {
        const age = Date.now() - new Date(event.capturedAt).getTime();
        if (age > MAX_QUEUED_AGE_MS || age < -30_000) continue;
      }
      const result = await ingestTracking(rider.id, event, { queued: true });
      if (result.accepted) accepted += 1;
      if (result.stopped) stopped = true;
    }
    return json({ accepted, received: events.length, stopped });
  });
}
