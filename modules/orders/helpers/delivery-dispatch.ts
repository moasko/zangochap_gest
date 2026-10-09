// Moteur de repartition des livraisons : calcul pur, sans acces base ni effet.
// Utilise par le serveur pour produire l'apercu ET les attributions appliquees,
// afin que l'administrateur valide exactement ce qui sera ecrit.
import { COMMUNES } from "@/lib/constants";

// Statuts que la repartition peut prendre en charge le jour de livraison.
export const DISPATCH_ELIGIBLE_STATUSES = ["PACKED", "ON_DELIVERY", "REPRO_DISPO"] as const;

// Regle metier : le partage se fait PAR COMMUNE, en alternance entre les livreurs de la
// commune (un colis au premier, un au deuxieme, un au premier...). Aucun equilibrage
// global : un colis ne part jamais chez un livreur hors de la zone ; a defaut, il reste
// « sans livreur » avec sa raison et l'admin decide.
// Livreur « habituel » d'une commune sans affectation : au moins 15 % de ses livraisons sur 30 jours.
export const HABITUAL_COMMUNE_SHARE = 0.15;
// Expeditions : uniquement le(s) livreur(s) affecte(s) ou habituel(s), jamais un livreur d'Abidjan.
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
  // Plafond general facultatif (fenetre de repartition) ; absent = aucun plafond.
  capacity?: number | null;
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
  // true : la repartition du soir inclut les colis confirmes / en preparation.
  includeUnpacked?: boolean;
};

export type DispatchAssignment = {
  orderId: string;
  riderId: string;
  reason: "repro" | "fixed" | "zone";
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

// Colis pas encore emballes que la repartition du soir peut attribuer d'avance (option).
export const DISPATCH_UNPACKED_STATUSES = ["CONFIRMED", "PREPARING"] as const;

const NOT_READY_REASONS: Record<string, string> = {
  UNAVAILABLE: "Indisponible (articles manquants)",
  PARTIAL: "Emballage partiel (articles manquants)",
  ALTERNATIVE: "Alternative proposee au client",
  PENDING: "En attente de validation",
  TO_PROCESS: "Commande web a traiter",
};

export type DispatchEligibilityOptions = { atConfirmation?: boolean; includeUnpacked?: boolean };

/** Raison pour laquelle la commande ne peut pas etre repartie automatiquement, sinon null. */
export function getDispatchIneligibility(order: DispatchOrder, options: DispatchEligibilityOptions = {}): string | null {
  if (order.settlementId) return "Deja rattachee a un reglement";
  // A la validation call center : commande CONFIRMED attribuee d'avance ; emballage
  // et depot expedition restent controles plus tard (le livreur ne la voit qu'emballee).
  const unpacked = DISPATCH_UNPACKED_STATUSES.includes(order.status as typeof DISPATCH_UNPACKED_STATUSES[number]);
  const statusOk = options.atConfirmation
    ? order.status === "CONFIRMED"
    : DISPATCH_ELIGIBLE_STATUSES.includes(order.status as typeof DISPATCH_ELIGIBLE_STATUSES[number])
      || (options.includeUnpacked === true && unpacked);
  if (!statusOk) {
    if (unpacked) return `Pas encore emballee (${order.status === "CONFIRMED" ? "confirmee" : "en preparation"})`;
    return NOT_READY_REASONS[order.status] || `Pas prete a livrer (statut ${order.status})`;
  }
  if (order.deliverymanId && order.status !== "REPRO_DISPO") return "Deja attribuee";
  const commune = normalizeCommune(order.commune);
  if (!commune) return order.commune?.trim() ? `Commune inconnue (${order.commune.trim()})` : "Commune manquante";
  if (!order.customerPhone?.trim()) return "Telephone manquant";
  // Le depot expedition est exige a l'emballage : pour un colis pas encore emballe,
  // il sera controle a ce moment-la.
  if (!options.atConfirmation && !unpacked && commune === "Hors Abidjan" && order.depositVerificationStatus && order.depositVerificationStatus !== "RECEIVED") {
    return "Depot expedition non valide";
  }
  return null;
}

function compareRef(a: DispatchOrder, b: DispatchOrder) {
  return String(a.ref || a.id).localeCompare(String(b.ref || b.id));
}

export function planDeliveryDispatch(input: DispatchInput): DispatchPlan {
  const generalCapacity = input.capacity && input.capacity > 0 ? Math.floor(input.capacity) : null;
  const present = input.riders
    .filter((rider) => input.presentRiderIds.includes(rider.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const presentIds = new Set(present.map((rider) => rider.id));

  const loads = new Map<string, number>();
  // Colis par livreur et par commune pour la date (deja attribues + proposes) : base de l'alternance.
  const communeCounts = new Map<string, Map<string, number>>();
  for (const rider of input.riders) {
    loads.set(rider.id, input.currentLoads[rider.id] || 0);
    const counts = new Map<string, number>();
    (input.currentCommunes[rider.id] || []).forEach((raw) => {
      const c = normalizeCommune(raw) || raw;
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    communeCounts.set(rider.id, counts);
  }
  const countIn = (riderId: string, commune: string) => communeCounts.get(riderId)?.get(commune) || 0;
  const before = new Map(loads);
  // Plafond : celui du planning du livreur, sinon le plafond general s'il est fixe, sinon aucun.
  const capacityOf = (riderId: string) => input.capacities?.[riderId] || generalCapacity || Infinity;
  const hasRoom = (riderId: string) => (loads.get(riderId) || 0) < capacityOf(riderId);

  const fixed = new Map(Object.entries(input.fixedCommunes || {})
    .map(([riderId, list]) => [riderId, new Set(list.map((c) => normalizeCommune(c) || c))]));
  const isFixed = (riderId: string, commune: string) => fixed.get(riderId)?.has(commune) || false;
  const isExpeditionOnly = (riderId: string) => {
    const communes = fixed.get(riderId);
    return Boolean(communes && communes.size > 0 && [...communes].every((c) => EXCLUSIVE_COMMUNES.has(c)));
  };

  const communeTotals = new Map<string, number>();
  for (const byCommune of Object.values(input.history)) {
    for (const [commune, count] of Object.entries(byCommune)) {
      communeTotals.set(commune, (communeTotals.get(commune) || 0) + count);
    }
  }
  const isHabitual = (riderId: string, commune: string) => {
    const count = input.history[riderId]?.[commune] || 0;
    const total = communeTotals.get(commune) || 0;
    return count > 0 && total > 0 && count / total >= HABITUAL_COMMUNE_SHARE;
  };

  const assignments: DispatchAssignment[] = [];
  const skipped: DispatchSkip[] = [];
  const assign = (order: DispatchOrder, riderId: string, commune: string, reason: DispatchAssignment["reason"]) => {
    assignments.push({ orderId: order.id, riderId, reason });
    loads.set(riderId, (loads.get(riderId) || 0) + 1);
    const counts = communeCounts.get(riderId);
    if (counts) counts.set(commune, (counts.get(commune) || 0) + 1);
  };
  // Alternance : celui qui a le moins de colis dans CETTE commune, puis le moins charge, puis l'ordre alphabetique.
  const nextInRotation = (candidates: DispatchRider[], commune: string) => [...candidates].sort((a, b) =>
    countIn(a.id, commune) - countIn(b.id, commune)
    || (loads.get(a.id) || 0) - (loads.get(b.id) || 0)
    || a.name.localeCompare(b.name))[0];

  const byCommune = new Map<string, DispatchOrder[]>();
  for (const order of [...input.orders].sort(compareRef)) {
    const ineligible = getDispatchIneligibility(order, { atConfirmation: input.atConfirmation, includeUnpacked: input.includeUnpacked });
    if (ineligible) {
      skipped.push({ orderId: order.id, reason: ineligible });
      continue;
    }
    const commune = normalizeCommune(order.commune)!;
    // Repro-dispo : le livreur qui connait deja le client garde la commande s'il est la.
    if (order.status === "REPRO_DISPO" && order.deliverymanId && presentIds.has(order.deliverymanId) && hasRoom(order.deliverymanId)) {
      assign(order, order.deliverymanId, commune, "repro");
      continue;
    }
    if (!byCommune.has(commune)) byCommune.set(commune, []);
    byCommune.get(commune)!.push(order);
  }

  for (const commune of [...byCommune.keys()].sort((a, b) => a.localeCompare(b))) {
    const exclusive = EXCLUSIVE_COMMUNES.has(commune);
    // Les livreurs de la commune : affectes dans le planning, sinon habituels (historique).
    const assigned = input.riders.filter((rider) => isFixed(rider.id, commune));
    const fromPlanning = assigned.length > 0;
    const team = fromPlanning
      ? assigned
      : input.riders.filter((rider) => isHabitual(rider.id, commune) && (exclusive || !isExpeditionOnly(rider.id)));

    for (const order of byCommune.get(commune)!) {
      const available = team.filter((rider) => presentIds.has(rider.id) && hasRoom(rider.id));
      if (available.length > 0) {
        assign(order, nextInRotation(available, commune).id, commune, fromPlanning ? "fixed" : "zone");
        continue;
      }
      // Jamais de debordement hors zone : l'admin choisit.
      let reason: string;
      if (team.length === 0) reason = `Aucun livreur affecte a ${commune} (a configurer dans le Planning)`;
      else if (!team.some((rider) => presentIds.has(rider.id))) reason = `Livreur(s) de ${commune} absent(s)`;
      else reason = `Livreur(s) de ${commune} au plafond`;
      skipped.push({ orderId: order.id, reason });
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
