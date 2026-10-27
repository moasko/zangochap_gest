import type { NextRequest } from "next/server";

import { handle, json, preflight, rateLimit } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";
import { addDeliveryProof, proofSchema } from "@/modules/rider-app/proof";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Preuve de livraison (photo et/ou signature), stockee en prive. */
export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    rateLimit(request, "rider-proof", 60, 10 * 60_000);
    const rider = await requireRider();
    return json(await addDeliveryProof(rider, (await params).id, proofSchema.parse(await request.json())), { status: 201 });
  });
}
