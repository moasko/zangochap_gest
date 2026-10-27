import type { NextRequest } from "next/server";

import { handle, json, preflight } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";
import { cashDaySchema, cashReportSchema, cashSummary, submitCashReport } from "@/modules/rider-app/tour";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Recapitulatif de caisse du jour (calcule par le serveur). */
export function GET(request: NextRequest) {
  return handle(async () => {
    const rider = await requireRider();
    const { date } = cashDaySchema.parse({ date: request.nextUrl.searchParams.get("date") });
    return json(await cashSummary(rider, date));
  });
}

/** Cloture du soir : envoyee au bureau (administrateurs et comptables), une fois par jour. */
export function POST(request: NextRequest) {
  return handle(async () => {
    const rider = await requireRider();
    return json(await submitCashReport(rider, cashReportSchema.parse(await request.json())), { status: 201 });
  });
}
