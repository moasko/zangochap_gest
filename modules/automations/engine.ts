// Coeur du moteur d'automatisations (declencheur -> conditions -> actions).
// Ce fichier n'est PAS un module "use server" : il est importe par les server
// actions (commandes, console admin) et par le planificateur (instrumentation.ts).
// Tout est best-effort : une automatisation ne doit JAMAIS faire echouer le
// flux metier qui l'a declenchee.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { appendCmsLog, readCmsLog, sendWhatsAppContent } from "@/modules/whatsapp/send";
import { normalizeIvorianPhone, orderTemplateVariables, renderTemplate } from "@/modules/whatsapp/message-builder";
import {
  type AutomationCondition,
  type AutomationLogEntry,
  type AutomationQueueJob,
  type AutomationRule,
  type AutomationSettings,
  type AutomationTriggerType,
  DEFAULT_AUTOMATION_SETTINGS,
  ORDER_STATUS_LABELS,
  describeDelay,
} from "./types";

// Stockage en CmsContent, comme le module WhatsApp (pas de migration).
export const AUTOMATION_RULES_KEY = "automation:rules";
export const AUTOMATION_LOG_KEY = "automation:log";
export const AUTOMATION_STATE_KEY = "automation:state";
export const AUTOMATION_SETTINGS_KEY = "automation:settings";
export const AUTOMATION_QUEUE_KEY = "automation:queue";

// Borne haute de la file : au-dela, les nouveaux envois differes sont refuses
// (et journalises en echec) plutot que de grossir sans limite.
const QUEUE_LIMIT = 300;

export type AutomationEvent =
  | { type: "order.created"; order: any }
  | { type: "order.status_changed"; order: any; fromStatus: string; toStatus: string }
  | { type: "stock.low"; product: { id: string; name: string; stock: number; threshold: number } };

// ============ STOCKAGE ============

export async function readAutomationRules(): Promise<AutomationRule[]> {
  const row = await prisma.cmsContent.findUnique({ where: { key: AUTOMATION_RULES_KEY } });
  return Array.isArray(row?.data) ? (row.data as unknown as AutomationRule[]) : [];
}

export async function writeAutomationRules(rules: AutomationRule[], updatedBy?: string) {
  await prisma.cmsContent.upsert({
    where: { key: AUTOMATION_RULES_KEY },
    update: { data: rules as any, updatedBy },
    create: { key: AUTOMATION_RULES_KEY, data: rules as any, updatedBy },
  });
}

// Etat interne (anti-doublons) : { scheduleFires: { [ruleId]: "YYYY-MM-DD" },
// lowStockAlerts: { [productId]: "YYYY-MM-DD" } }.
async function readAutomationState(): Promise<Record<string, any>> {
  const row = await prisma.cmsContent.findUnique({ where: { key: AUTOMATION_STATE_KEY } });
  return row?.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? { ...(row.data as Record<string, any>) }
    : {};
}

async function writeAutomationState(state: Record<string, any>) {
  await prisma.cmsContent.upsert({
    where: { key: AUTOMATION_STATE_KEY },
    update: { data: state as any },
    create: { key: AUTOMATION_STATE_KEY, data: state as any },
  });
}

export async function readAutomationLog() {
  return readCmsLog(AUTOMATION_LOG_KEY);
}

// ============ RÉGLAGES (garde-fous d'envoi client) ============

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const row = await prisma.cmsContent.findUnique({ where: { key: AUTOMATION_SETTINGS_KEY } });
  const data = row?.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? (row.data as Record<string, unknown>)
    : {};
  const isTime = (value: unknown): value is string => typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
  return {
    quietHoursEnabled: data.quietHoursEnabled === undefined
      ? DEFAULT_AUTOMATION_SETTINGS.quietHoursEnabled
      : Boolean(data.quietHoursEnabled),
    sendStart: isTime(data.sendStart) ? data.sendStart : DEFAULT_AUTOMATION_SETTINGS.sendStart,
    sendEnd: isTime(data.sendEnd) ? data.sendEnd : DEFAULT_AUTOMATION_SETTINGS.sendEnd,
    dailyLimitPerRecipient: Number.isFinite(Number(data.dailyLimitPerRecipient))
      ? Math.max(0, Math.trunc(Number(data.dailyLimitPerRecipient)))
      : DEFAULT_AUTOMATION_SETTINGS.dailyLimitPerRecipient,
  };
}

export async function writeAutomationSettings(settings: AutomationSettings, updatedBy?: string) {
  await prisma.cmsContent.upsert({
    where: { key: AUTOMATION_SETTINGS_KEY },
    update: { data: settings as any, updatedBy },
    create: { key: AUTOMATION_SETTINGS_KEY, data: settings as any, updatedBy },
  });
}

// ============ FILE D'ATTENTE ============

// Verrou en memoire : un seul process Node (VPS), mais les mutations de la file
// peuvent s'entrelacer (evenement commande + tick planificateur simultanes).
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.catch(() => undefined);
  return run;
}

export async function readAutomationQueue(): Promise<AutomationQueueJob[]> {
  const row = await prisma.cmsContent.findUnique({ where: { key: AUTOMATION_QUEUE_KEY } });
  return Array.isArray(row?.data) ? (row.data as unknown as AutomationQueueJob[]) : [];
}

async function writeAutomationQueue(queue: AutomationQueueJob[]) {
  await prisma.cmsContent.upsert({
    where: { key: AUTOMATION_QUEUE_KEY },
    update: { data: queue as any },
    create: { key: AUTOMATION_QUEUE_KEY, data: queue as any },
  });
}

async function enqueueJob(job: AutomationQueueJob): Promise<boolean> {
  return withQueueLock(async () => {
    const queue = await readAutomationQueue();
    if (queue.length >= QUEUE_LIMIT) return false;
    await writeAutomationQueue([...queue, job]);
    return true;
  });
}

export async function cancelQueuedJob(jobId: string) {
  await withQueueLock(async () => {
    const queue = await readAutomationQueue();
    await writeAutomationQueue(queue.filter((job) => job.id !== jobId));
  });
}

// ============ HORLOGE (Abidjan = UTC, sans heure d'ete) ============

function abidjanClock() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    dateKey: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`,
    hm: `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`,
    weekday: now.getUTCDay(),
  };
}

// ============ FENÊTRE D'ENVOI & PLAFOND CLIENT ============

function isWithinSendWindow(settings: AutomationSettings, hm: string): boolean {
  if (settings.sendStart <= settings.sendEnd) {
    return hm >= settings.sendStart && hm <= settings.sendEnd;
  }
  // Fenetre a cheval sur minuit (ex. 22:00 -> 06:00).
  return hm >= settings.sendStart || hm <= settings.sendEnd;
}

function nextWindowOpenISO(settings: AutomationSettings): string {
  const { dateKey, hm } = abidjanClock();
  const open = new Date(`${dateKey}T${settings.sendStart}:00.000Z`);
  if (hm >= settings.sendStart) open.setUTCDate(open.getUTCDate() + 1);
  return open.toISOString();
}

// Compteur d'envois clients du jour : { sendCounts: { date, counts: { [tel]: n } } }.
async function customerSendCountToday(phone: string): Promise<number> {
  const { dateKey } = abidjanClock();
  const state = await readAutomationState();
  if (state.sendCounts?.date !== dateKey) return 0;
  return Number(state.sendCounts?.counts?.[phone] || 0);
}

async function bumpCustomerSendCount(phone: string) {
  const { dateKey } = abidjanClock();
  const state = await readAutomationState();
  const counts: Record<string, number> = state.sendCounts?.date === dateKey && state.sendCounts?.counts
    ? { ...state.sendCounts.counts }
    : {};
  counts[phone] = Number(counts[phone] || 0) + 1;
  await writeAutomationState({ ...state, sendCounts: { date: dateKey, counts } });
}

// ============ CONDITIONS ============

function conditionContext(event: AutomationEvent): Record<string, unknown> {
  if (event.type === "stock.low") {
    return {
      produit: event.product.name,
      stock: event.product.stock,
      seuil: event.product.threshold,
    };
  }
  const order = event.order || {};
  return {
    montant: Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0),
    commune: order.commune,
    status: event.type === "order.status_changed" ? event.toStatus : order.status,
    type: order.type,
    paymentMethod: order.paymentMethod,
    itemsCount: Array.isArray(order.items) ? order.items.length : 0,
  };
}

function evaluateCondition(context: Record<string, unknown>, condition: AutomationCondition): boolean {
  const raw = context[condition.field];
  if (raw === undefined || raw === null) return false;

  const numericLeft = Number(raw);
  const numericRight = Number(String(condition.value).replace(/\s/g, ""));
  const bothNumeric = Number.isFinite(numericLeft) && Number.isFinite(numericRight) && String(condition.value).trim() !== "";

  if (["gt", "gte", "lt", "lte"].includes(condition.op)) {
    if (!bothNumeric) return false;
    if (condition.op === "gt") return numericLeft > numericRight;
    if (condition.op === "gte") return numericLeft >= numericRight;
    if (condition.op === "lt") return numericLeft < numericRight;
    return numericLeft <= numericRight;
  }

  const left = String(raw).toLowerCase().trim();
  const right = String(condition.value).toLowerCase().trim();
  if (condition.op === "eq") return bothNumeric ? numericLeft === numericRight : left === right;
  if (condition.op === "neq") return bothNumeric ? numericLeft !== numericRight : left !== right;
  return left.includes(right);
}

function matchesConditions(event: AutomationEvent, rule: AutomationRule): boolean {
  if (!rule.conditions?.length) return true;
  const context = conditionContext(event);
  return rule.conditions.every((condition) => evaluateCondition(context, condition));
}

// ============ VARIABLES DE MESSAGE ============

function fmtFcfa(value: number) {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0))} FCFA`;
}

function orderEventVariables(order: any, toStatus?: string): Record<string, string> {
  const status = toStatus || order?.status || "";
  return {
    ...orderTemplateVariables(order),
    "{statut}": ORDER_STATUS_LABELS[status] || status || "—",
  };
}

function stockEventVariables(product: { name: string; stock: number; threshold: number }): Record<string, string> {
  return {
    "{produit}": product.name,
    "{stock}": String(product.stock),
    "{seuil}": String(product.threshold),
  };
}

// Recap du jour pour les regles planifiees. Base "encaisse" : amountReceived
// (aligne sur la comptabilite), avec repli sur le montant theorique.
export async function buildScheduleVariables(): Promise<Record<string, string>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [createdCount, deliveredOrders] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: todayStart, lt: tomorrowStart }, deletedAt: null } }),
    prisma.order.findMany({
      where: {
        deliveryDate: { gte: todayStart, lt: tomorrowStart },
        status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] },
        deletedAt: null,
      },
      select: { amountReceived: true, total: true, deliveryFee: true, discount: true },
    }),
  ]);

  const collected = deliveredOrders.reduce((sum, order) => {
    const theoretical = Math.max(0, (order.total || 0) + (order.deliveryFee || 0) - (order.discount || 0));
    return sum + (order.amountReceived ?? theoretical);
  }, 0);

  return {
    "{date}": new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    "{commandes_jour}": String(createdCount),
    "{livrees_jour}": String(deliveredOrders.length),
    "{ca_encaisse_jour}": fmtFcfa(collected),
  };
}

// ============ EXECUTION ============

async function logExecution(entry: AutomationLogEntry) {
  await appendCmsLog(AUTOMATION_LOG_KEY, entry as unknown as Record<string, unknown>);
}

async function bumpRuleCounters(ruleIds: string[]) {
  if (!ruleIds.length) return;
  const rules = await readAutomationRules();
  const now = new Date().toISOString();
  let changed = false;
  for (const rule of rules) {
    if (ruleIds.includes(rule.id)) {
      rule.runCount = (rule.runCount || 0) + 1;
      rule.lastRunAt = now;
      changed = true;
    }
  }
  if (changed) await writeAutomationRules(rules, "automation-engine");
}

type OutgoingMessage = Omit<AutomationQueueJob, "id" | "createdAt" | "notBefore">;

function logBase(outgoing: OutgoingMessage) {
  return {
    at: new Date().toISOString(),
    ruleId: outgoing.ruleId,
    ruleName: outgoing.ruleName,
    trigger: outgoing.trigger,
    recipient: normalizeIvorianPhone(outgoing.recipient),
    preview: outgoing.message.slice(0, 120) || null,
  };
}

// Envoi immediat, avec garde-fous pour les messages CLIENTS : hors fenetre
// d'envoi le message est reporte a la prochaine ouverture ; au-dela du plafond
// quotidien il est ignore. Les numeros personnalises (equipe) partent toujours.
async function deliverNow(outgoing: OutgoingMessage) {
  const base = logBase(outgoing);

  if (outgoing.recipientKind === "customer") {
    const settings = await getAutomationSettings();
    const { hm } = abidjanClock();

    if (settings.quietHoursEnabled && !isWithinSendWindow(settings, hm)) {
      const notBefore = nextWindowOpenISO(settings);
      const queued = await enqueueJob({ ...outgoing, id: randomUUID(), createdAt: base.at, notBefore });
      await logExecution({
        ...base,
        status: queued ? "queued" : "failed",
        error: queued
          ? `Hors fenêtre d'envoi (${settings.sendStart}–${settings.sendEnd}) : reporté à l'ouverture.`
          : "File d'attente pleine : envoi abandonné.",
      });
      return;
    }

    if (settings.dailyLimitPerRecipient > 0) {
      const count = await customerSendCountToday(base.recipient);
      if (count >= settings.dailyLimitPerRecipient) {
        await logExecution({
          ...base,
          status: "skipped",
          error: `Plafond quotidien atteint pour ce client (${settings.dailyLimitPerRecipient} message${settings.dailyLimitPerRecipient > 1 ? "s" : ""}/jour).`,
        });
        return;
      }
    }
  }

  const result = await sendWhatsAppContent({
    recipient: outgoing.recipient,
    body: outgoing.message,
    byName: `Automatisation « ${outgoing.ruleName} »`,
  });

  if (result.success && outgoing.recipientKind === "customer") {
    await bumpCustomerSendCount(base.recipient);
  }

  await logExecution({
    ...base,
    status: result.success ? "sent" : "failed",
    error: result.success ? null : result.error,
  });
}

async function executeRule(
  rule: AutomationRule,
  triggerType: AutomationTriggerType,
  variables: Record<string, string>,
  customerPhone?: string | null,
  orderContext?: { id: string; ref: string | null; status: string },
) {
  for (const action of rule.actions || []) {
    if (action.type !== "whatsapp") continue;

    const recipient = action.recipient === "customer" ? customerPhone : action.phone;
    const message = renderTemplate(action.message, variables);

    if (!recipient) {
      await logExecution({
        at: new Date().toISOString(),
        ruleId: rule.id,
        ruleName: rule.name,
        trigger: triggerType,
        recipient: null,
        status: "failed",
        preview: message.slice(0, 120) || null,
        error: "Destinataire introuvable (numéro client manquant ?).",
      });
      continue;
    }

    const outgoing: OutgoingMessage = {
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: triggerType,
      recipientKind: action.recipient,
      recipient,
      message,
      orderId: orderContext?.id,
      orderRef: orderContext?.ref ?? null,
      statusAtEnqueue: orderContext?.status,
      cancelIfStatusChanged: Boolean(action.cancelIfStatusChanged && orderContext),
    };

    const delay = Math.max(0, Math.trunc(Number(action.delayMinutes || 0)));
    if (delay > 0) {
      const notBefore = new Date(Date.now() + delay * 60_000).toISOString();
      const queued = await enqueueJob({ ...outgoing, id: randomUUID(), createdAt: new Date().toISOString(), notBefore });
      await logExecution({
        ...logBase(outgoing),
        status: queued ? "queued" : "failed",
        error: queued
          ? `Envoi différé programmé (${describeDelay(delay)}).`
          : "File d'attente pleine : envoi abandonné.",
      });
    } else {
      await deliverNow(outgoing);
    }
  }
}

function ruleMatchesEvent(rule: AutomationRule, event: AutomationEvent): boolean {
  if (!rule.enabled || rule.trigger?.type !== event.type) return false;
  if (event.type === "order.status_changed") {
    const statuses = rule.trigger.statuses || [];
    if (statuses.length && !statuses.includes(event.toStatus)) return false;
  }
  return matchesConditions(event, rule);
}

async function runEvent(event: AutomationEvent) {
  const rules = (await readAutomationRules()).filter((rule) => ruleMatchesEvent(rule, event));
  if (!rules.length) return;

  const variables = event.type === "stock.low"
    ? stockEventVariables(event.product)
    : orderEventVariables(event.order, event.type === "order.status_changed" ? event.toStatus : undefined);
  const customerPhone = event.type === "stock.low" ? null : event.order?.customerPhone;
  const orderContext = event.type !== "stock.low" && event.order?.id
    ? {
        id: String(event.order.id),
        ref: event.order.ref ?? null,
        status: String(event.type === "order.status_changed" ? event.toStatus : event.order.status || ""),
      }
    : undefined;

  for (const rule of rules) {
    try {
      await executeRule(rule, event.type, variables, customerPhone, orderContext);
    } catch (error) {
      console.error(`[automations] Échec de la règle « ${rule.name} » :`, error);
    }
  }
  await bumpRuleCounters(rules.map((rule) => rule.id));
}

// Point d'entree unique appele par les flux metier. Ne remonte jamais d'erreur :
// la commande/le statut priment sur l'automatisation.
export async function triggerAutomations(event: AutomationEvent) {
  try {
    await runEvent(event);
  } catch (error) {
    console.error("[automations] Erreur moteur :", error);
  }
}

// ============ STOCK BAS ============

// Apres un emballage (decrement du stock), verifie les produits de la commande
// et emet au plus UNE alerte par produit et par jour.
export async function checkLowStockAfterOrder(order: { items?: Array<{ productId?: string | null }> }) {
  try {
    const rules = await readAutomationRules();
    if (!rules.some((rule) => rule.enabled && rule.trigger?.type === "stock.low")) return;

    const productIds = Array.from(new Set((order.items || []).map((item) => item.productId).filter(Boolean))) as string[];
    if (!productIds.length) return;

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, stock: true, lowStockThreshold: true },
    });

    const { dateKey } = abidjanClock();
    const state = await readAutomationState();
    const alerts: Record<string, string> = state.lowStockAlerts && typeof state.lowStockAlerts === "object"
      ? { ...state.lowStockAlerts }
      : {};
    let changed = false;

    for (const product of products) {
      const threshold = product.lowStockThreshold || 0;
      if (threshold <= 0 || product.stock > threshold) continue;
      if (alerts[product.id] === dateKey) continue;
      alerts[product.id] = dateKey;
      changed = true;
      await runEvent({
        type: "stock.low",
        product: { id: product.id, name: product.name, stock: product.stock, threshold },
      });
    }

    if (changed) await writeAutomationState({ ...state, lowStockAlerts: alerts });
  } catch (error) {
    console.error("[automations] Erreur alerte stock bas :", error);
  }
}

// ============ PLANIFICATEUR ============

// Marque une regle planifiee comme deja executee aujourd'hui (utilise a la
// sauvegarde quand l'heure choisie est deja passee, pour eviter un envoi
// surprise a la minute suivante).
export async function markScheduleFiredToday(ruleId: string) {
  const { dateKey } = abidjanClock();
  const state = await readAutomationState();
  const fires: Record<string, string> = state.scheduleFires && typeof state.scheduleFires === "object"
    ? { ...state.scheduleFires }
    : {};
  fires[ruleId] = dateKey;
  await writeAutomationState({ ...state, scheduleFires: fires });
}

// Tick appele chaque minute par instrumentation.ts. Une regle planifiee se
// declenche a la premiere minute >= son heure, une seule fois par jour.
export async function runScheduledAutomations() {
  try {
    const rules = (await readAutomationRules()).filter(
      (rule) => rule.enabled && rule.trigger?.type === "schedule" && rule.trigger.time,
    );
    if (!rules.length) return;

    const { dateKey, hm, weekday } = abidjanClock();
    const state = await readAutomationState();
    const fires: Record<string, string> = state.scheduleFires && typeof state.scheduleFires === "object"
      ? { ...state.scheduleFires }
      : {};

    const due = rules.filter((rule) => {
      if (fires[rule.id] === dateKey) return false;
      if (rule.trigger.days?.length && !rule.trigger.days.includes(weekday)) return false;
      return (rule.trigger.time as string) <= hm;
    });
    if (!due.length) return;

    // On marque AVANT d'envoyer pour eviter un double envoi si le tick suivant
    // demarre pendant un envoi lent.
    for (const rule of due) fires[rule.id] = dateKey;
    await writeAutomationState({ ...state, scheduleFires: fires });

    const variables = await buildScheduleVariables();
    for (const rule of due) {
      try {
        await executeRule(rule, "schedule", variables, null);
      } catch (error) {
        console.error(`[automations] Échec de la règle planifiée « ${rule.name} » :`, error);
      }
    }
    await bumpRuleCounters(due.map((rule) => rule.id));
  } catch (error) {
    console.error("[automations] Erreur planificateur :", error);
  }
}

// ============ TRAITEMENT DE LA FILE ============

// Livre les envois arrives a echeance. Les jobs echus sont retires de la file
// AVANT livraison (pas de double envoi si un envoi est lent) ; un job client
// hors fenetre d'envoi est simplement re-enfile pour l'ouverture suivante.
export async function processAutomationQueue() {
  try {
    const nowIso = new Date().toISOString();
    const due = await withQueueLock(async () => {
      const queue = await readAutomationQueue();
      const ready = queue.filter((job) => job.notBefore <= nowIso);
      if (ready.length) {
        await writeAutomationQueue(queue.filter((job) => job.notBefore > nowIso));
      }
      return ready;
    });

    for (const job of due) {
      try {
        if (job.cancelIfStatusChanged && job.orderId && job.statusAtEnqueue) {
          const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: { status: true } });
          if (!order || order.status !== job.statusAtEnqueue) {
            const newStatus = order ? (ORDER_STATUS_LABELS[order.status] || order.status) : "commande introuvable";
            await logExecution({
              ...logBase(job),
              status: "skipped",
              error: `Envoi annulé : le statut de la commande a changé (${newStatus}).`,
            });
            continue;
          }
        }
        await deliverNow(job);
      } catch (error) {
        console.error(`[automations] Échec d'un envoi en file (« ${job.ruleName} ») :`, error);
      }
    }
  } catch (error) {
    console.error("[automations] Erreur traitement de la file :", error);
  }
}

// Tick unique appele chaque minute par instrumentation-node.ts.
export async function runAutomationTick() {
  await processAutomationQueue();
  await runScheduledAutomations();
}
