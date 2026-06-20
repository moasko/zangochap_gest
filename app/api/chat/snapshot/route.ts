import { NextResponse } from "next/server";
import { getChatSnapshot } from "@/modules/chat/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getChatSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat indisponible." },
      { status: 500 },
    );
  }
}
