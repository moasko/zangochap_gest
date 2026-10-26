import type { NextRequest } from "next/server";
import { z } from "zod";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { registerDevice } from "@/modules/push/engine";
import { requireRider } from "@/modules/rider-app/api";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const schema = z.object({ token: z.string().trim().min(10).max(200), platform: z.enum(["ios", "android"]), appVersion: z.string().trim().max(30).nullish() });

/** Appareil du livreur connecte : recoit les push « nouvelle mission ». */
export function POST(request: NextRequest) {
  return handle(async () => {
    const rider = await requireRider();
    const input = schema.parse(await request.json());
    return json(await registerDevice({ ...input, riderId: rider.id, topics: { orders: true, promotions: false, cartReminders: false } }));
  });
}
