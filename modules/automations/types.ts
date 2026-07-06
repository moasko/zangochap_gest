// Types et catalogues PURS du moteur d'automatisations : importables cote client
// (builder de la console admin) comme cote serveur (moteur). Ne rien ajouter ici
// qui touche prisma, l'auth ou les variables d'environnement.

import { ORDER_TEMPLATE_VARIABLES } from "@/modules/whatsapp/message-builder";

export type AutomationTriggerType =
  | "order.created"
  | "order.status_changed"
  | "stock.low"
  | "schedule";

export type AutomationConditionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains";

export type AutomationCondition = {
  field: string;
  op: AutomationConditionOp;
  value: string;
};

export type AutomationAction = {
  type: "whatsapp";
  // "customer" = client de la commande (triggers commande uniquement),
  // "custom" = numero fixe (manager, groupe interne...).
  recipient: "customer" | "custom";
  phone?: string;
  message: string;
  // Envoi differe en minutes (0/absent = immediat). Le message est mis en file
  // d'attente et part au premier tick apres l'echeance.
  delayMinutes?: number;
  // Pour un envoi differe sur un declencheur commande : annuler si le statut a
  // change entre-temps (ex. relance "toujours a traiter", avis apres livraison).
  cancelIfStatusChanged?: boolean;
};

export type AutomationTrigger = {
  type: AutomationTriggerType;
  // order.status_changed : ne declencher que pour ces statuts (vide = tous).
  statuses?: string[];
  // schedule : heure d'execution "HH:mm" (heure d'Abidjan).
  time?: string;
  // schedule : jours actifs, 0 = dimanche ... 6 = samedi (vide = tous les jours).
  days?: number[];
};

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunAt: string | null;
};

export type AutomationLogEntry = {
  at: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTriggerType;
  recipient: string | null;
  // "queued" = mis en file d'attente (differe ou hors fenetre d'envoi),
  // "skipped" = volontairement non envoye (plafond atteint, statut modifie...).
  status: "sent" | "failed" | "queued" | "skipped";
  preview: string | null;
  error: string | null;
};

// Garde-fous globaux appliques aux messages CLIENTS uniquement (les numeros
// personnalises — equipe, managers — ne sont jamais limites).
export type AutomationSettings = {
  quietHoursEnabled: boolean;
  sendStart: string; // "HH:mm" (heure d'Abidjan)
  sendEnd: string;
  dailyLimitPerRecipient: number; // 0 = illimite
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  quietHoursEnabled: true,
  sendStart: "08:00",
  sendEnd: "20:00",
  dailyLimitPerRecipient: 3,
};

// Envoi en attente dans la file (differe, ou reporte hors fenetre d'envoi).
export type AutomationQueueJob = {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTriggerType;
  recipientKind: "customer" | "custom";
  recipient: string;
  message: string;
  createdAt: string;
  notBefore: string;
  orderId?: string;
  orderRef?: string | null;
  statusAtEnqueue?: string;
  cancelIfStatusChanged?: boolean;
};

export function describeDelay(minutes?: number): string {
  const m = Math.max(0, Math.trunc(Number(minutes || 0)));
  if (!m) return "immédiat";
  if (m % 1440 === 0) return `après ${m / 1440} j`;
  if (m % 60 === 0) return `après ${m / 60} h`;
  return `après ${m} min`;
}

export const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  "order.created": "Commande créée",
  "order.status_changed": "Statut de commande modifié",
  "stock.low": "Stock bas (seuil produit atteint)",
  "schedule": "Planification (heure fixe)",
};

export const TRIGGER_DESCRIPTIONS: Record<AutomationTriggerType, string> = {
  "order.created": "Se déclenche à chaque nouvelle commande (site web ou back-office).",
  "order.status_changed": "Se déclenche quand une commande change de statut (livrée, annulée...).",
  "stock.low": "Se déclenche quand le stock d'un produit passe sous son seuil d'alerte, après un emballage.",
  "schedule": "Se déclenche chaque jour à l'heure choisie (récap, rappels...).",
};

// Meme vocabulaire que le back-office (voir status-actions.ts).
export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  TO_PROCESS: "À traiter",
  CONFIRMED: "Confirmée",
  PREPARING: "En préparation",
  PACKED: "Emballée",
  PARTIAL: "Emballage partiel",
  ON_DELIVERY: "En livraison",
  DELIVERED: "Livrée",
  PARTIALLY_DELIVERED: "Livrée partiellement",
  CANCELLED: "Annulée",
  RETURNED: "Retournée",
  EXCHANGED: "Échange effectué",
  REPROGRAMMED: "Reprogrammée",
  REPRO_DISPO: "Repro-dispo",
  UNAVAILABLE: "Indisponible",
  ALTERNATIVE: "Alternative proposée",
};

export const OPERATOR_LABELS: Record<AutomationConditionOp, string> = {
  eq: "est égal à",
  neq: "est différent de",
  gt: "est supérieur à",
  gte: "est supérieur ou égal à",
  lt: "est inférieur à",
  lte: "est inférieur ou égal à",
  contains: "contient",
};

export type ConditionFieldDef = {
  key: string;
  label: string;
  kind: "number" | "text";
  triggers: AutomationTriggerType[];
};

const ORDER_TRIGGERS: AutomationTriggerType[] = ["order.created", "order.status_changed"];

export const CONDITION_FIELDS: ConditionFieldDef[] = [
  { key: "montant", label: "Montant total (FCFA)", kind: "number", triggers: ORDER_TRIGGERS },
  { key: "commune", label: "Commune", kind: "text", triggers: ORDER_TRIGGERS },
  { key: "status", label: "Statut", kind: "text", triggers: ["order.created"] },
  { key: "type", label: "Type de commande", kind: "text", triggers: ORDER_TRIGGERS },
  { key: "paymentMethod", label: "Moyen de paiement", kind: "text", triggers: ORDER_TRIGGERS },
  { key: "itemsCount", label: "Nombre d'articles", kind: "number", triggers: ORDER_TRIGGERS },
  { key: "produit", label: "Nom du produit", kind: "text", triggers: ["stock.low"] },
  { key: "stock", label: "Stock restant", kind: "number", triggers: ["stock.low"] },
];

export function conditionFieldsForTrigger(trigger: AutomationTriggerType) {
  return CONDITION_FIELDS.filter((field) => field.triggers.includes(trigger));
}

// Variables utilisables dans le message, selon le declencheur.
export const AUTOMATION_VARIABLES: Record<AutomationTriggerType, Array<{ key: string; label: string }>> = {
  "order.created": [...ORDER_TEMPLATE_VARIABLES, { key: "{statut}", label: "Statut de la commande" }],
  "order.status_changed": [...ORDER_TEMPLATE_VARIABLES, { key: "{statut}", label: "Statut de la commande" }],
  "stock.low": [
    { key: "{produit}", label: "Nom du produit" },
    { key: "{stock}", label: "Stock restant" },
    { key: "{seuil}", label: "Seuil d'alerte" },
  ],
  "schedule": [
    { key: "{date}", label: "Date du jour" },
    { key: "{commandes_jour}", label: "Commandes créées aujourd'hui" },
    { key: "{livrees_jour}", label: "Commandes livrées aujourd'hui" },
    { key: "{ca_encaisse_jour}", label: "CA encaissé aujourd'hui" },
  ],
};

// 0 = dimanche ... 6 = samedi (convention Date.getDay()).
export const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export function describeTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "order.status_changed") {
    const statuses = (trigger.statuses || []).map((s) => ORDER_STATUS_LABELS[s] || s);
    return statuses.length ? `Statut → ${statuses.join(", ")}` : "Tout changement de statut";
  }
  if (trigger.type === "schedule") {
    const days = trigger.days && trigger.days.length && trigger.days.length < 7
      ? ` (${trigger.days.map((d) => DAY_LABELS[d]).join(", ")})`
      : "";
    return `Chaque jour à ${trigger.time || "--:--"}${days}`;
  }
  return TRIGGER_LABELS[trigger.type];
}
