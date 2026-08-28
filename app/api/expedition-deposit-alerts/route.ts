import { NextResponse } from "next/server";
import { getMyDepositAlerts } from "@/modules/expedition-deposits/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMyDepositAlerts());
  } catch {
    return NextResponse.json([], { status: 401 });
  }
}
