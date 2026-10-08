import { z } from "zod";
import { COMMUNES } from "@/lib/constants";

// Planning des livreurs, stocke dans CmsContent (aucune table dediee).
export const DELIVERY_PLANNING_KEY = "delivery-dispatch:planning";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COMMUNE_NAMES = Object.keys(COMMUNES) as [string, ...string[]];

export const RiderAbsenceSchema = z.object({
  id: z.string().min(1).max(40),
  from: z.string().regex(DAY, "Date de debut invalide"),
  to: z.string().regex(DAY, "Date de fin invalide"),
  reason: z.string().trim().max(80).default(""),
}).refine((absence) => absence.from <= absence.to, { message: "La fin de l'absence precede son debut" });

export const RiderPlanningSchema = z.object({
  // false : le livreur n'est jamais propose a la repartition (depart, suspension...).
  inDispatch: z.boolean().default(true),
  // 0 = dimanche ... 6 = samedi.
  workDays: z.array(z.number().int().min(0).max(6)).max(7).transform((days) => Array.from(new Set(days)).sort()),
  absences: z.array(RiderAbsenceSchema).max(60).default([]),
  fixedCommunes: z.array(z.enum(COMMUNE_NAMES)).max(COMMUNE_NAMES.length).transform((list) => Array.from(new Set(list))).default([]),
  capacity: z.number().int().min(1).max(60).nullable().default(null),
});

export type RiderAbsence = z.infer<typeof RiderAbsenceSchema>;
export type RiderPlanning = z.infer<typeof RiderPlanningSchema>;

export type DeliveryPlanningSettings = {
  // Attribuer un livreur des que le call center valide la commande (CONFIRMED).
  autoAssignOnConfirm: boolean;
};

export type DeliveryPlanning = {
  riders: Record<string, RiderPlanning>;
  settings: DeliveryPlanningSettings;
};

export const DEFAULT_PLANNING_SETTINGS: DeliveryPlanningSettings = { autoAssignOnConfirm: false };

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5, 6];

export const WEEK_DAYS = [
  { value: 1, short: "L", label: "Lundi" },
  { value: 2, short: "M", label: "Mardi" },
  { value: 3, short: "M", label: "Mercredi" },
  { value: 4, short: "J", label: "Jeudi" },
  { value: 5, short: "V", label: "Vendredi" },
  { value: 6, short: "S", label: "Samedi" },
  { value: 0, short: "D", label: "Dimanche" },
] as const;

/** Lecture tolerante du JSON stocke : les entrees invalides sont ignorees, jamais bloquantes. */
export function parseDeliveryPlanning(data: unknown): DeliveryPlanning {
  const riders: Record<string, RiderPlanning> = {};
  const raw = (data && typeof data === "object" && "riders" in data ? (data as { riders: unknown }).riders : null);
  if (raw && typeof raw === "object") {
    for (const [riderId, value] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = RiderPlanningSchema.safeParse(value);
      if (parsed.success) riders[riderId] = parsed.data;
    }
  }
  const rawSettings = (data && typeof data === "object" && "settings" in data ? (data as { settings: unknown }).settings : null);
  const settings: DeliveryPlanningSettings = {
    autoAssignOnConfirm: Boolean(rawSettings && typeof rawSettings === "object"
      && (rawSettings as { autoAssignOnConfirm?: unknown }).autoAssignOnConfirm === true),
  };
  return { riders, settings };
}

export type RiderAvailability = {
  present: boolean;
  source: "planning" | "activity";
  reason: string;
};

function weekDay(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/**
 * Disponibilite d'un livreur pour une date (AAAA-MM-JJ).
 * Sans planning enregistre, on retombe sur l'activite recente fournie par l'appelant.
 */
export function getRiderAvailability(planning: RiderPlanning | undefined, date: string, recentlyActive: boolean): RiderAvailability {
  if (!planning) {
    return recentlyActive
      ? { present: true, source: "activity", reason: "Actif ces 7 derniers jours" }
      : { present: false, source: "activity", reason: "Sans activite recente" };
  }
  if (!planning.inDispatch) return { present: false, source: "planning", reason: "Hors repartition" };
  const absence = planning.absences.find((item) => item.from <= date && date <= item.to);
  if (absence) return { present: false, source: "planning", reason: absence.reason ? `Absent : ${absence.reason}` : "Absent" };
  if (!planning.workDays.includes(weekDay(date))) return { present: false, source: "planning", reason: "Jour de repos" };
  return { present: true, source: "planning", reason: "Planning" };
}
