import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/modules/auth/actions";
import { readDeliveryProof } from "@/modules/rider-app/proof";

export const dynamic = "force-dynamic";

const STAFF_ROLES = ["admin", "developer", "commercial", "comptable"];

/** Image d'une preuve de livraison (?part=photo|signature), equipe connectee uniquement. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) return NextResponse.json({ error: "Acces refuse." }, { status: 403 });
  const proof = await readDeliveryProof(decodeURIComponent((await params).key));
  const part = request.nextUrl.searchParams.get("part") === "signature" ? "signature" : "photo";
  const data = proof?.[part];
  if (!data) return NextResponse.json({ error: "Preuve introuvable." }, { status: 404 });
  return new NextResponse(Buffer.from(data, "base64"), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
}
