import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { trackingInput, validCaptureTime } from "@/modules/rider-tracking/validation";

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
    const data = parsed.data;
    const now = new Date();
    if (data.action === "start") {
      await prisma.$transaction(async tx => {
      await tx.riderTrackingState.upsert({
        where: { riderId: user.id },
        create: { riderId: user.id, sessionId: data.sessionId, active: true, startedAt: now },
        update: {
          sessionId: data.sessionId, active: true, startedAt: now, stoppedAt: null,
          latitude: null, longitude: null, accuracy: null, capturedAt: null, lastReceivedAt: null,
        },
      });
      await tx.$queryRaw`SELECT pg_notify('rider_tracking_changed', '')::text`;
      });
      return json({ success: true });
    }
    if (data.action === "stop") {
      await prisma.$transaction(async tx => {
      await tx.riderTrackingState.updateMany({
        where: { riderId: user.id, sessionId: data.sessionId },
        data: { active: false, stoppedAt: now },
      });
      await tx.$queryRaw`SELECT pg_notify('rider_tracking_changed', '')::text`;
      });
      return json({ success: true });
    }
    const capturedAt = new Date(data.capturedAt);
    if (!validCaptureTime(capturedAt, now)) return json({ error: "Position trop ancienne ou horloge incorrecte." }, 400);
    const result = await prisma.$transaction(async tx => {
      // Claim the state row before inserting: concurrent stop/restart and point
      // requests serialize on this row. Old sessions cannot send new points.
      const claimed = await tx.riderTrackingState.updateMany({
        where: {
          riderId: user.id, sessionId: data.sessionId, active: true,
          AND: [
            { OR: [{ lastReceivedAt: null }, { lastReceivedAt: { lte: new Date(now.getTime() - 8000) } }] },
            { OR: [{ capturedAt: null }, { capturedAt: { lt: capturedAt } }] },
          ],
        },
        data: { latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy, capturedAt, lastReceivedAt: now },
      });
      if (!claimed.count) {
        const state = await tx.riderTrackingState.findUnique({ where: { riderId: user.id } });
        return { accepted: false, stopped: !state?.active || state.sessionId !== data.sessionId };
      }
      await tx.riderLocationPoint.create({
        data: {
          id: data.id, riderId: user.id, sessionId: data.sessionId,
          latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy,
          capturedAt, receivedAt: now,
        },
      });
      await tx.$queryRaw`SELECT pg_notify('rider_tracking_changed', '')::text`;
      return { accepted: true, stopped: false };
    });
    return json(result, result.stopped ? 409 : 200);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return json({ accepted: false, duplicate: true });
      if (["P2021", "P2022"].includes(error.code)) return json({ error: "Suivi GPS en attente d’activation par l’administrateur." }, 503);
    }
    return json({ error: "Impossible d’enregistrer le suivi. Réessayez." }, 503);
  }
}
