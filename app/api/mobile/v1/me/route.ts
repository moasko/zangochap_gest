import type { NextRequest } from "next/server";

import { customerProfile, requireCustomer } from "@/modules/mobile-api/customer";
import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(request: NextRequest) {
  return handle(async () => json(customerProfile(await requireCustomer(request))));
}
