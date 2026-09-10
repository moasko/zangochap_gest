import type { RiderTrackPoint } from "./types";
export function trackSegments(points: RiderTrackPoint[]): RiderTrackPoint[][] {
  const grouped = new Map<string, RiderTrackPoint[]>();
  for (const point of points) {
    const list = grouped.get(point.riderId) || [];
    list.push(point); grouped.set(point.riderId, list);
  }
  const segments: RiderTrackPoint[][] = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.id.localeCompare(b.id));
    let segment: RiderTrackPoint[] = [];
    for (const point of list) {
      const previous = segment[segment.length - 1];
      if (previous && (previous.sessionId !== point.sessionId || Date.parse(point.capturedAt) - Date.parse(previous.capturedAt) > 300000)) {
        segments.push(segment); segment = [];
      }
      segment.push(point);
    }
    if (segment.length) segments.push(segment);
  }
  return segments;
}
