import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";
import prisma from "@/lib/prisma";
import { historyRange } from "@/modules/rider-tracking/validation";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user || !["ADMIN", "DEVELOPER"].includes(user.role.toUpperCase())) return json({ error: "Accès administrateur requis." }, 403);
  const mode = req.nextUrl.searchParams.get("mode") || "live";
  try {
    const riders = await prisma.user.findMany({
      where: { role: "LIVREUR" }, select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    if (mode === "live") {
      const states = await prisma.riderTrackingState.findMany({
        where: { rider: { role: "LIVREUR" } },
        select: {
          riderId: true, sessionId: true, active: true, startedAt: true, stoppedAt: true,
          capturedAt: true, lastReceivedAt: true, latitude: true, longitude: true, accuracy: true,
        },
      });
      return json({ riders, states, points: [], total: 0, truncated: false, serverTime: new Date() });
    }
    if (mode !== "history") return json({ error: "Mode invalide." }, 400);
    const riderId = req.nextUrl.searchParams.get("riderId") || "";
    if (!riders.some(r => r.id === riderId)) return json({ error: "Choisissez un livreur." }, 400);
    let capturedAt;
    try {
      capturedAt = historyRange(req.nextUrl.searchParams.get("day") || "", req.nextUrl.searchParams.get("from") || "00:00", req.nextUrl.searchParams.get("to") || "23:59");
    } catch { return json({ error: "Date ou plage horaire invalide." }, 400); }
    const result = await prisma.$transaction(async tx => {
      const where = { riderId, capturedAt };
      const total = await tx.riderLocationPoint.count({ where });
      const points = await tx.riderLocationPoint.findMany({
        where, orderBy: [{ capturedAt: "asc" }, { id: "asc" }], take: 10000,
        select: { id: true, riderId: true, sessionId: true, latitude: true, longitude: true, accuracy: true, capturedAt: true, receivedAt: true },
      });
      return { total, points };
    }, { isolationLevel: "RepeatableRead" });
    return json({ riders, states: [], ...result, truncated: result.total > result.points.length, serverTime: new Date() });
  } catch {
    return json({ error: "Carte indisponible : vérifiez l’activation des tables GPS et la connexion." }, 503);
  }
}
