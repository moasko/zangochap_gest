// Enregistrement du suivi GPS d'un livreur (demarrage, arret, position), partage par
// l'espace web (/api/rider-tracking, cookie) et l'application livreur (/api/rider/v1/tracking).
import prisma from "@/lib/prisma";

import { validCaptureTime } from "./validation";

type TrackingInput =
  | { action: "start"; sessionId: string }
  | { action: "stop"; sessionId: string }
  | { action: "point"; sessionId: string; id: string; latitude: number; longitude: number; accuracy: number; capturedAt: string };

// Cadence minimale entre deux points (heure de capture pour un lot, de reception sinon).
const MIN_INTERVAL_MS = 8000;

export type IngestResult = { accepted: boolean; stopped: boolean; error?: string };

/**
 * `queued` : point capture plus tot (hors ligne) et envoye en lot ; seule la regle
 * d'ordre chronologique s'applique, l'anciennete est bornee par l'appelant.
 */
export async function ingestTracking(riderId: string, data: TrackingInput, options: { queued?: boolean } = {}): Promise<IngestResult> {
  const now = new Date();
  if (data.action === "start") {
    await prisma.$transaction(async (tx) => {
      await tx.riderTrackingState.upsert({
        where: { riderId },
        create: { riderId, sessionId: data.sessionId, active: true, startedAt: now },
        update: {
          sessionId: data.sessionId, active: true, startedAt: now, stoppedAt: null,
          latitude: null, longitude: null, accuracy: null, capturedAt: null, lastReceivedAt: null,
        },
      });
      await tx.$queryRaw`SELECT pg_notify('rider_tracking_changed', '')::text`;
    });
    return { accepted: true, stopped: false };
  }
  if (data.action === "stop") {
    await prisma.$transaction(async (tx) => {
      await tx.riderTrackingState.updateMany({ where: { riderId, sessionId: data.sessionId }, data: { active: false, stoppedAt: now } });
      await tx.$queryRaw`SELECT pg_notify('rider_tracking_changed', '')::text`;
    });
    return { accepted: true, stopped: false };
  }

  const capturedAt = new Date(data.capturedAt);
  if (!options.queued && !validCaptureTime(capturedAt, now)) return { accepted: false, stopped: false, error: "Position trop ancienne ou horloge incorrecte." };

  return prisma.$transaction(async (tx) => {
    // Reservation de la ligne d'etat avant l'insertion : arret/redemarrage et points
    // concurrents se serialisent ici ; une ancienne session ne peut plus envoyer de point.
    const cadence = options.queued
      ? { OR: [{ capturedAt: null }, { capturedAt: { lte: new Date(capturedAt.getTime() - MIN_INTERVAL_MS) } }] }
      : {
          AND: [
            { OR: [{ lastReceivedAt: null }, { lastReceivedAt: { lte: new Date(now.getTime() - MIN_INTERVAL_MS) } }] },
            { OR: [{ capturedAt: null }, { capturedAt: { lt: capturedAt } }] },
          ],
        };
    const claimed = await tx.riderTrackingState.updateMany({
      where: { riderId, sessionId: data.sessionId, active: true, ...cadence },
      data: { latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy, capturedAt, lastReceivedAt: now },
    });
    if (!claimed.count) {
      const state = await tx.riderTrackingState.findUnique({ where: { riderId } });
      return { accepted: false, stopped: !state?.active || state.sessionId !== data.sessionId };
    }
    await tx.riderLocationPoint.create({
      data: {
        id: data.id, riderId, sessionId: data.sessionId,
        latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy,
        capturedAt, receivedAt: now,
      },
    });
    await tx.$queryRaw`SELECT pg_notify('rider_tracking_changed', '')::text`;
    return { accepted: true, stopped: false };
  });
}
