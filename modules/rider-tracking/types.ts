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
  total: number;
  truncated: boolean;
  serverTime: string;
};
export function trackingStatus(state: RiderTrackState | undefined, now: number) {
  if (!state?.active) return "Arrêté";
  if (!state.capturedAt || !state.lastReceivedAt) return "En attente GPS";
  return now - new Date(state.lastReceivedAt).getTime() > 90000 || now - new Date(state.capturedAt).getTime() > 120000 ? "Position ancienne" : "Suivi actif";
}
