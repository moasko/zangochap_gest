export type RiderTrackPoint = {
  id: string;
  riderId: string;
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  receivedAt: string;
};
export type RiderTrackState = {
  riderId: string;
  sessionId: string;
  active: boolean;
  startedAt: string;
  stoppedAt: string | null;
  capturedAt: string | null;
  lastReceivedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};
export type RiderTrackingResponse = {
  riders: { id: string; name: string; phone: string | null }[];
  states: RiderTrackState[];
  points: RiderTrackPoint[];
  tracks?: { riderId: string; total: number; shown: number; truncated: boolean }[];
  total: number;
  truncated: boolean;
  serverTime: string;
};
export function trackingStatus(state: RiderTrackState | undefined, now: number) {
  if (!state?.active) return "Arrêté";
  if (!state.capturedAt || !state.lastReceivedAt) return "En attente GPS";
  return now - new Date(state.lastReceivedAt).getTime() > 90000 || now - new Date(state.capturedAt).getTime() > 120000 ? "Position ancienne" : "Suivi actif";
}

export function positionAge(capturedAt: string | null | undefined, now: number): string {
  if (!capturedAt) return "Aucune position reçue";
  const seconds = Math.max(0, Math.floor((now - Date.parse(capturedAt)) / 1000));
  if (!Number.isFinite(seconds)) return "Date indisponible";
  if (seconds < 60) return "Position il y a " + seconds + " s";
  if (seconds < 3600) return "Position il y a " + Math.floor(seconds / 60) + " min";
  if (seconds < 86400) return "Position il y a " + Math.floor(seconds / 3600) + " h";
  return "Position il y a " + Math.floor(seconds / 86400) + " j";
}
