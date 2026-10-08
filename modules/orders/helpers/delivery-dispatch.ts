// Moteur de repartition des livraisons : calcul pur, sans acces base ni effet.
// Utilise par le serveur pour produire l'apercu ET les attributions appliquees,
// afin que l'administrateur valide exactement ce qui sera ecrit.
import { COMMUNES } from "@/lib/constants";

export const DISPATCH_DEFAULT_CAPACITY = 18;
// Statuts que la repartition peut prendre en charge le jour de livraison.
export const DISPATCH_ELIGIBLE_STATUSES = ["PACKED", "ON_DELIVERY", "REPRO_DISPO"] as const;

// Poids du score : zone habituelle du livreur, part du livreur dans la commune,
// regroupement d'une meme commune sur une tournee, penalite par colis deja porte.
const WEIGHT_RIDER_ZONE = 0.6;
const WEIGHT_COMMUNE_SHARE = 0.4;
const WEIGHT_SAME_COMMUNE_TODAY = 0.35;
const PENALTY_PER_PARCEL = 0.03;
// Au-dela de la part equitable du jour, un livreur ne garde la commande que si
// sa zone est nettement plus pertinente que celle des autres.
const PENALTY_OVER_FAIR_SHARE = 0.45;
// Zone fixee dans le planning : prioritaire sur les zones apprises.
const WEIGHT_FIXED_ZONE = 2;
// Expeditions : uniquement le(s) livreur(s) affecte(s) ou habituel(s), sinon a l'admin de choisir.
const EXCLUSIVE_COMMUNES = new Set(["Hors Abidjan"]);

export type DispatchOrder = {
  id: string;
  ref: string | null;
  status: string;
  commune: string | null;
  customerPhone: string | null;
  customerLocation: string | null;
  deliverymanId: string | null;
  settlementId: string | null;
  depositVerificationStatus: string | null;
};

export type DispatchRider = { id: string; name: string };

export type DispatchInput = {
  orders: DispatchOrder[];
  riders: DispatchRider[];
  presentRiderIds: string[];
  capacity: number;
  // Colis deja attribues pour la date visee, hors commandes a repartir.
  currentLoads: Record<string, number>;
  // Communes deja servies par chaque livreur pour la date visee.
  currentCommunes: Record<string, string[]>;
  // Historique recent : nombre de colis par livreur et par commune normalisee.
  history: Record<string, Record<string, number>>;
  // Planning : plafond propre a un livreur (sinon `capacity`) et communes fixees.
  capacities?: Record<string, number>;
  fixedCommunes?: Record<string, string[]>;
  // true : attribution d'avance a la validation call center (commandes CONFIRMED).
  atConfirmation?: boolean;
};

export type DispatchAssignment = {
  orderId: string;
  riderId: string;
  reason: "repro" | "fixed" | "zone" | "charge";
};

export type DispatchSkip = { orderId: string; reason: string };

export type DispatchPlan = {
  assignments: DispatchAssignment[];
  skipped: DispatchSkip[];
  loads: Record<string, { before: number; after: number }>;
};

function foldCommune(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CANONICAL_COMMUNES = new Map(Object.keys(COMMUNES).map((name) => [foldCommune(name), name]));

/** Nom officiel de la commune (« yopougon », « Port bouet » → forme canonique), sinon null. */
export function normalizeCommune(value: string | null | undefined) {
  if (!value?.trim()) return null;
  return CANONICAL_COMMUNES.get(foldCommune(value)) ?? null;
}

/** Raison pour laquelle la commande ne peut pas etre repartie automatiquement, sinon null. */
export function getDispatchIneligibility(order: DispatchOrder, options: { atConfirmation?: boolean } = {}): string | null {
  if (order.settlementId) return "Deja rattachee a un reglement";
  // A la validation call center : commande CONFIRMED attribuee d'avance ; emballage
  // et depot expedition restent controles plus tard (le livreur ne la voit qu'emballee).
  const statusOk = options.atConfirmation
    ? order.status === "CONFIRMED"
    : DISPATCH_ELIGIBLE_STATUSES.includes(order.status as typeof DISPATCH_ELIGIBLE_STATUSES[number]);
  if (!statusOk) {
    return `Pas prete a livrer (statut ${order.status})`;
  }
  if (order.deliverymanId && order.status !== "REPRO_DISPO") return "Deja attribuee";
  const commune = normalizeCommune(order.commune);
  if (!commune) return order.commune?.trim() ? `Commune inconnue (${order.commune.trim()})` : "Commune manquante";
  if (!order.customerPhone?.trim()) return "Telephone manquant";
  if (!options.atConfirmation && commune === "Hors Abidjan" && order.depositVerificationStatus && order.depositVerificationStatus !== "RECEIVED") {
    return "Depot expedition non valide";
  }
  return null;
}

function compareRef(a: DispatchOrder, b: DispatchOrder) {
  return String(a.ref || a.id).localeCompare(String(b.ref || b.id));
}

export function planDeliveryDispatch(input: DispatchInput): DispatchPlan {
  const capacity = Math.max(1, Math.floor(input.capacity));
  const present = input.riders
    .filter((rider) => input.presentRiderIds.includes(rider.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const presentIds = new Set(present.map((rider) => rider.id));

  const loads = new Map<string, number>();
  const communesToday = new Map<string, Set<string>>();
  // Colis par livreur et par commune pour la date (deja attribues + proposes) : base du partage egal.
  const communeCounts = new Map<string, Map<string, number>>();
  for (const rider of input.riders) {
    loads.set(rider.id, input.currentLoads[rider.id] || 0);
    const current = (input.currentCommunes[rider.id] || []).map((c) => normalizeCommune(c) || c);
    communesToday.set(rider.id, new Set(current));
    const counts = new Map<string, number>();
    current.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
    communeCounts.set(rider.id, counts);
  }
  const countIn = (riderId: string, commune: string) => communeCounts.get(riderId)?.get(commune) || 0;
  const before = new Map(loads);
  const capacityOf = (riderId: string) => Math.max(1, Math.floor(input.capacities?.[riderId] || capacity));
  const fixed = new Map(Object.entries(input.fixedCommunes || {})
    .map(([riderId, list]) => [riderId, new Set(list.map((c) => normalizeCommune(c) || c))]));
  const isFixed = (riderId: string, commune: string) => fixed.get(riderId)?.has(commune) || false;

  const riderTotals = new Map<string, number>();
  const communeTotals = new Map<string, number>();
  for (const [riderId, byCommune] of Object.entries(input.history)) {
    for (const [commune, count] of Object.entries(byCommune)) {
      riderTotals.set(riderId, (riderTotals.get(riderId) || 0) + count);
      communeTotals.set(commune, (communeTotals.get(commune) || 0) + count);
    }
  }
  const affinity = (riderId: string, commune: string) => {
    const count = input.history[riderId]?.[commune] || 0;
    if (!count) return 0;
    return WEIGHT_RIDER_ZONE * (count / (riderTotals.get(riderId) || 1))
      + WEIGHT_COMMUNE_SHARE * (count / (communeTotals.get(commune) || 1));
  };

  const assignments: DispatchAssignment[] = [];
  const skipped: DispatchSkip[] = [];
  const assign = (order: DispatchOrder, riderId: string, commune: string, reason: DispatchAssignment["reason"]) => {
    assignments.push({ orderId: order.id, riderId, reason });
    loads.set(riderId, (loads.get(riderId) || 0) + 1);
    communesToday.get(riderId)?.add(commune);
    const counts = communeCounts.get(riderId);
    if (counts) counts.set(commune, (counts.get(commune) || 0) + 1);
  };
  // Livreurs affectes a une commune dans le planning (presents ou non).
  const assignedTo = (commune: string) => input.riders.filter((rider) => isFixed(rider.id, commune));

  const byCommune = new Map<string, DispatchOrder[]>();
  for (const order of [...input.orders].sort(compareRef)) {
    const ineligible = getDispatchIneligibility(order, { atConfirmation: input.atConfirmation });
    if (ineligible) {
      skipped.push({ orderId: order.id, reason: ineligible });
      continue;
    }
    const commune = normalizeCommune(order.commune)!;
    // Repro-dispo : le livreur qui connait deja le client garde la commande s'il est la.
    if (order.status === "REPRO_DISPO" && order.deliverymanId && presentIds.has(order.deliverymanId)
      && (loads.get(order.deliverymanId) || 0) < capacityOf(order.deliverymanId)) {
      assign(order, order.deliverymanId, commune, "repro");
      continue;
    }
    if (!byCommune.has(commune)) byCommune.set(commune, []);
    byCommune.get(commune)!.push(order);
  }

  // Les communes servies par peu de livreurs habituels (expeditions, boutique,
  // peripheries) passent en premier pour ne pas perdre leurs specialistes.
  const specialists = (commune: string) =>
    present.filter((rider) => isFixed(rider.id, commune) || affinity(rider.id, commune) > 0).length || Infinity;
  const toPlace = [...byCommune.values()].reduce((sum, orders) => sum + orders.length, 0);
  const presentLoad = present.reduce((sum, rider) => sum + (loads.get(rider.id) || 0), 0);
  const fairShare = present.length ? Math.ceil((presentLoad + toPlace) / present.length) : 0;

  const communes = [...byCommune.keys()].sort((a, b) =>
    specialists(a) - specialists(b) || byCommune.get(b)!.length - byCommune.get(a)!.length || a.localeCompare(b));

  for (const commune of communes) {
    const assigned = assignedTo(commune);
    const exclusive = EXCLUSIVE_COMMUNES.has(commune);
    for (const order of byCommune.get(commune)!) {
      // 1. Commune affectee : partage a parts egales entre les affectes presents
      //    (le moins pourvu dans CETTE commune d'abord, puis le moins charge).
      const available = assigned.filter((rider) => presentIds.has(rider.id) && (loads.get(rider.id) || 0) < capacityOf(rider.id));
      if (available.length > 0) {
        const pick = [...available].sort((a, b) =>
          countIn(a.id, commune) - countIn(b.id, commune)
          || (loads.get(a.id) || 0) - (loads.get(b.id) || 0)
          || a.name.localeCompare(b.name))[0];
        assign(order, pick.id, commune, "fixed");
        continue;
      }
      // 2. Expedition : jamais envoyee au hasard a un livreur d'Abidjan.
      if (exclusive && assigned.length > 0) {
        skipped.push({ orderId: order.id, reason: `Livreur(s) affecte(s) a ${commune} absent(s) ou au plafond` });
        continue;
      }
      // 3. Sinon : zones habituelles, regroupement et equilibre.
      let best: { rider: DispatchRider; score: number; reason: DispatchAssignment["reason"] } | null = null;
      for (const rider of present) {
        if (exclusive && affinity(rider.id, commune) === 0) continue;
        const load = loads.get(rider.id) || 0;
        if (load >= capacityOf(rider.id)) continue;
        const zone = affinity(rider.id, commune);
        const fixedZone = isFixed(rider.id, commune);
        const score = zone
          + (fixedZone ? WEIGHT_FIXED_ZONE : 0)
          + (communesToday.get(rider.id)?.has(commune) ? WEIGHT_SAME_COMMUNE_TODAY : 0)
          - PENALTY_PER_PARCEL * load
          - (load >= fairShare ? PENALTY_OVER_FAIR_SHARE : 0);
        // Egalite : le moins charge, puis ordre alphabetique (present est trie).
        if (!best || score > best.score + 1e-9
          || (Math.abs(score - best.score) <= 1e-9 && load < (loads.get(best.rider.id) || 0))) {
          best = { rider, score, reason: fixedZone ? "fixed" : zone > 0 ? "zone" : "charge" };
        }
      }
      if (!best) {
        skipped.push({
          orderId: order.id,
          reason: exclusive
            ? `Aucun livreur habituel de ${commune} disponible`
            : present.length ? "Plafond atteint pour tous les livreurs presents" : "Aucun livreur present",
        });
        continue;
      }
      assign(order, best.rider.id, commune, best.reason);
    }
  }

  const loadSummary: DispatchPlan["loads"] = {};
  for (const rider of input.riders) {
    const after = loads.get(rider.id) || 0;
    const start = before.get(rider.id) || 0;
    if (after !== start || presentIds.has(rider.id)) loadSummary[rider.id] = { before: start, after };
  }

  return { assignments, skipped, loads: loadSummary };
}
