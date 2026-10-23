import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { openedPushSchema } from "@/modules/mobile-api/push";
import { recordCampaignOpen } from "@/modules/push/engine";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Ouverture d'une notification de campagne (statistique « ouvertes » de la console). */
export function POST(request: NextRequest) {
  return handle(async () => {
    rateLimit(request, "push-opened", 60, 10 * 60_000);
    const { campaignId } = openedPushSchema.parse(await request.json());
    await recordCampaignOpen(campaignId);
    return json({ ok: true });
  });
}
