import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";
import { Prisma } from "@prisma/client";
import { ingestTracking } from "@/modules/rider-tracking/ingest";
import { trackingInput } from "@/modules/rider-tracking/validation";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  // Next may build nextUrl with the internal server hostname behind a proxy.
  // Compare to the request Host, never to an arbitrary forwarded host.
  const expectedOrigin = req.headers.get("host") ? req.nextUrl.protocol + "//" + req.headers.get("host") : req.nextUrl.origin;
  if (req.headers.get("origin") !== expectedOrigin) return json({ error: "Origine non autorisée." }, 403);
  const user = await getSession();
  if (!user || user.role.toUpperCase() !== "LIVREUR") return json({ error: "Accès réservé au livreur connecté." }, 403);
  try {
    if (Number(req.headers.get("content-length")) > 2048) return json({ error: "Requête trop volumineuse." }, 413);
    const body = await req.text();
    if (body.length > 2048) return json({ error: "Requête trop volumineuse." }, 413);
    let value: unknown;
    try { value = JSON.parse(body); } catch { return json({ error: "Requête invalide." }, 400); }
    const parsed = trackingInput.safeParse(value);
    if (!parsed.success) return json({ error: "Position ou session invalide." }, 400);
    const result = await ingestTracking(user.id, parsed.data);
    if (result.error) return json({ error: result.error }, 400);
    if (parsed.data.action !== "point") return json({ success: true });
    return json({ accepted: result.accepted, stopped: result.stopped }, result.stopped ? 409 : 200);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return json({ accepted: false, duplicate: true });
      if (["P2021", "P2022"].includes(error.code)) return json({ error: "Suivi GPS en attente d’activation par l’administrateur." }, 503);
    }
    return json({ error: "Impossible d’enregistrer le suivi. Réessayez." }, 503);
  }
}
