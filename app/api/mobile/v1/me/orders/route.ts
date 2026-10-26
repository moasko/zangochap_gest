import type { NextRequest } from "next/server";

import { customerOrders, requireCustomer } from "@/modules/mobile-api/customer";
import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Commandes du client connecte (tous canaux, par numero de telephone). */
export function GET(request: NextRequest) {
  return handle(async () => json(await customerOrders(await requireCustomer(request))));
}
