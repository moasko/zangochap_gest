import { z } from "zod";

export const trackingInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), sessionId: z.string().uuid() }),
  z.object({ action: z.literal("stop"), sessionId: z.string().uuid() }),
  z.object({
    action: z.literal("point"),
    sessionId: z.string().uuid(),
    id: z.string().uuid(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(100000),
    capturedAt: z.string().datetime(),
  }),
]);

export function validCaptureTime(capturedAt: Date, now: Date) {
  const age = now.getTime() - capturedAt.getTime();
  return age >= -30000 && age <= 120000;
}

export function historyRange(day: string, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(to)) throw new Error("Date ou heure invalide.");
  const start = new Date(day + "T" + from + ":00.000Z");
  const end = new Date(day + "T" + to + ":59.999Z");
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== day || end < start) throw new Error("Période invalide.");
  return { gte: start, lte: end };
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
