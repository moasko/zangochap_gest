"use client";

// Demo locale du Planning livreurs (donnees fictives, enregistrements simules en memoire).
import React from "react";
import PlanningClient from "@/modules/delivery-planning/components/PlanningClient";
import { DEFAULT_WORK_DAYS, RiderPlanningSchema, getRiderAvailability, type RiderPlanning } from "@/modules/delivery-planning/types";
import { DEMO_RIDERS } from "./DeliveryDemo";

function dayKey(offset: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function PlanningDemo() {
  const today = dayKey(0);
  const tomorrow = dayKey(1);
  const riders = DEMO_RIDERS.map((r) => {
    // Awa n'a pas encore de planning : la demo montre sa saisie.
    const planning: RiderPlanning | null = r.recent > 0 && r.id !== "awa"
      ? { inDispatch: true, workDays: DEFAULT_WORK_DAYS, absences: [], fixedCommunes: r.communes, capacity: r.capacity ?? null }
      : null;
    const recentlyActive = r.recent > 0;
    return {
      id: r.id, name: r.name, phone: null, recentCount: Math.round(r.recent / 2), lastDelivery: recentlyActive ? today : null,
      recentlyActive, planning,
      today: getRiderAvailability(planning || undefined, today, recentlyActive),
      tomorrow: getRiderAvailability(planning || undefined, tomorrow, recentlyActive),
    };
  });

  return (
    <PlanningClient
      initial={{ today, tomorrow, autoAssignOnConfirm: false, riders }}
      actions={{
        save: async (_riderId, input) => {
          const parsed = RiderPlanningSchema.safeParse(input);
          return parsed.success
            ? { success: true as const, planning: parsed.data }
            : { success: false as const, error: parsed.error.issues[0]?.message || "Donnees invalides" };
        },
        reset: async () => ({ success: true as const }),
        setAuto: async (enabled) => ({ success: true as const, enabled }),
      }}
    />
  );
}
