// Zones de livraison de l'API mobile : table Commune (actives) + points relais.
import prisma from "@/lib/prisma";
import { normalizeCommune } from "@/modules/orders/helpers/delivery-dispatch";
import { getActiveRelayPoints } from "@/modules/boutique/relay-queries";

export type DeliveryZone = { commune: string; fee: number; kind: "abidjan" | "outside" | "pickup"; minDays: number; maxDays: number };

const OUTSIDE = new Set(["Hors Abidjan", "Bouake"]);

/**
 * Regroupe les communes actives par nom officiel (la table contient des doublons de casse ou
 * d'orthographe : « yopougon »/« Yopougon », « BOUAKE »/« Bouaké »). En cas de tarifs differents,
 * le plus eleve l'emporte (un doublon a 0 F est une erreur de saisie, pas une gratuite).
 */
export function buildZones(rows: { name: string; deliveryFee: number }[]): DeliveryZone[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const name = normalizeCommune(row.name) ?? row.name.trim();
    byName.set(name, Math.max(byName.get(name) ?? 0, row.deliveryFee));
  }
  return [...byName.entries()]
    .map(([commune, fee]): DeliveryZone => {
      const kind = commune === "Boutique" ? "pickup" : OUTSIDE.has(commune) ? "outside" : "abidjan";
      return { commune, fee: kind === "pickup" ? 0 : fee, kind, minDays: kind === "outside" ? 2 : kind === "pickup" ? 0 : 1, maxDays: kind === "outside" ? 4 : kind === "pickup" ? 1 : 2 };
    })
    .sort((a, b) => Number(a.kind === "pickup") - Number(b.kind === "pickup") || Number(a.kind === "outside") - Number(b.kind === "outside") || a.commune.localeCompare(b.commune, "fr"));
}

export async function getDeliveryZones() {
  const rows = await prisma.commune.findMany({ where: { isActive: true }, select: { name: true, deliveryFee: true } });
  return buildZones(rows);
}

/** Points relais actifs, sans doublon de casse (« port bouet » / « Port bouet » = un seul point). */
export async function getRelayPoints() {
  const seen = new Map<string, string>();
  for (const name of await getActiveRelayPoints()) {
    const key = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    // Garde la variante la mieux ecrite (majuscule initiale).
    if (!seen.has(key) || /^[A-Z]/.test(name)) seen.set(key, name);
  }
  return [...seen.values()];
}

/** Zone officielle d'une commune saisie (null si inconnue ou inactive). */
export async function findZone(commune: string) {
  const name = normalizeCommune(commune) ?? commune.trim();
  return (await getDeliveryZones()).find((zone) => zone.commune === name) ?? null;
}
