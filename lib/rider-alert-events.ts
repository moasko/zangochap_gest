import type { Role } from "@prisma/client";

type RiderMessageAlertPayload = {
  id: string;
  body: string;
  senderName: string;
  senderPhone: string | null;
  createdAt: string;
};

type RiderAlertTarget = {
  scope: "DIRECT" | "ROLE";
  recipientId: string | null;
  targetRole: Role | null;
};

export type RiderAlertEvent = RiderMessageAlertPayload & RiderAlertTarget;

type RiderAlertListener = (event: RiderAlertEvent) => void;

const listeners = new Set<RiderAlertListener>();

export function subscribeToRiderAlerts(listener: RiderAlertListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitRiderAlert(event: RiderAlertEvent) {
  listeners.forEach((listener) => listener(event));
}

export function canReceiveRiderAlert(
  event: RiderAlertTarget,
  user: { id: string; role: Role },
) {
  if (event.scope === "DIRECT") return event.recipientId === user.id;
  return event.targetRole === user.role;
}
