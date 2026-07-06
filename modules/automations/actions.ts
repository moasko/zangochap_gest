"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureAuth } from "@/lib/auth";
import { normalizeIvorianPhone, orderTemplateVariables, renderTemplate, SAMPLE_ORDER } from "@/modules/whatsapp/message-builder";
import { sendWhatsAppContent } from "@/modules/whatsapp/send";
import {
  buildScheduleVariables,
  cancelQueuedJob,
  getAutomationSettings,
  markScheduleFiredToday,
  readAutomationLog,
  readAutomationQueue,
  readAutomationRules,
  writeAutomationRules,
  writeAutomationSettings,
} from "./engine";
import type { AutomationRule, AutomationSettings, AutomationTriggerType } from "./types";

const AUTOMATIONS_PATH = "/zangochap-manager/admin/automations";

const ConditionSchema = z.object({
  field: z.string().trim().min(1).max(40),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains"]),
  value: z.string().trim().min(1).max(200),
});

const ActionSchema = z.object({
  type: z.literal("whatsapp"),
  recipient: z.enum(["customer", "custom"]),
  phone: z.string().trim().max(20).optional(),
  message: z.string().trim().min(1).max(4096),
  // Envoi differe : 0 = immediat, max 30 jours.
  delayMinutes: z.number().int().min(0).max(43200).optional(),
  cancelIfStatusChanged: z.boolean().optional(),
});

const TriggerSchema = z.object({
  type: z.enum(["order.created", "order.status_changed", "stock.low", "schedule"]),
  statuses: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

const RuleInputSchema = z.object({
  id: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1, "Donnez un nom à l'automatisation.").max(80),
  enabled: z.boolean(),
  trigger: TriggerSchema,
  conditions: z.array(ConditionSchema).max(10),
  actions: z.array(ActionSchema).min(1, "Ajoutez au moins une action.").max(3),
});

export type AutomationRuleInput = z.infer<typeof RuleInputSchema>;

async function requireAutomationAdmin() {
  return ensureAuth(["admin", "developer"]);
}

function validateRule(input: AutomationRuleInput) {
  const rule = RuleInputSchema.parse(input);

  if (rule.trigger.type === "schedule" && !rule.trigger.time) {
    throw new Error("Choisissez une heure d'exécution pour la planification.");
  }

  for (const action of rule.actions) {
    if (action.recipient === "customer" && !["order.created", "order.status_changed"].includes(rule.trigger.type)) {
      throw new Error("Ce déclencheur n'a pas de client associé : utilisez un numéro personnalisé.");
    }
    if (action.recipient === "custom") {
      const phone = normalizeIvorianPhone(action.phone || "");
      if (!/^\d{8,15}$/.test(phone)) {
        throw new Error("Le numéro personnalisé du destinataire est invalide.");
      }
    }
  }

  return rule;
}

export async function getAutomationsConsoleData() {
  await requireAutomationAdmin();
  const [rules, log, settings, queue] = await Promise.all([
    readAutomationRules(),
    readAutomationLog(),
    getAutomationSettings(),
    readAutomationQueue(),
  ]);
  return {
    rules,
    log,
    settings,
    queue: [...queue].sort((a, b) => a.notBefore.localeCompare(b.notBefore)),
  };
}

const SettingsSchema = z.object({
  quietHoursEnabled: z.boolean(),
  sendStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  sendEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  dailyLimitPerRecipient: z.number().int().min(0).max(50),
});

export async function updateAutomationSettings(input: AutomationSettings) {
  const session = await requireAutomationAdmin();
  const settings = SettingsSchema.parse(input);
  await writeAutomationSettings(settings, session.email);
  revalidatePath(AUTOMATIONS_PATH);
  return { success: true as const, settings };
}

export async function cancelQueuedAutomation(jobId: string) {
  await requireAutomationAdmin();
  await cancelQueuedJob(String(jobId));
  revalidatePath(AUTOMATIONS_PATH);
  const queue = await readAutomationQueue();
  return { success: true as const, queue: [...queue].sort((a, b) => a.notBefore.localeCompare(b.notBefore)) };
}

export async function saveAutomationRule(input: AutomationRuleInput) {
  const session = await requireAutomationAdmin();
  const validated = validateRule(input);
  const now = new Date().toISOString();

  const rules = await readAutomationRules();
  const existing = validated.id ? rules.find((rule) => rule.id === validated.id) : undefined;

  const saved: AutomationRule = {
    id: existing?.id || randomUUID(),
    name: validated.name,
    enabled: validated.enabled,
    trigger: validated.trigger,
    conditions: validated.conditions,
    actions: validated.actions,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    runCount: existing?.runCount || 0,
    lastRunAt: existing?.lastRunAt || null,
  };

  const next = existing
    ? rules.map((rule) => (rule.id === saved.id ? saved : rule))
    : [saved, ...rules];
  await writeAutomationRules(next, session.email);

  // Regle planifiee dont l'heure est deja passee aujourd'hui : on la considere
  // comme deja executee pour eviter un envoi surprise a la minute suivante.
  if (saved.enabled && saved.trigger.type === "schedule" && saved.trigger.time) {
    const now = new Date();
    const hm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    if (saved.trigger.time <= hm && !existing) {
      await markScheduleFiredToday(saved.id);
    }
  }

  revalidatePath(AUTOMATIONS_PATH);
  return { success: true as const, rules: next };
}

export async function toggleAutomationRule(ruleId: string, enabled: boolean) {
  const session = await requireAutomationAdmin();
  const rules = await readAutomationRules();
  const next = rules.map((rule) =>
    rule.id === ruleId ? { ...rule, enabled, updatedAt: new Date().toISOString() } : rule,
  );
  await writeAutomationRules(next, session.email);
  revalidatePath(AUTOMATIONS_PATH);
  return { success: true as const, rules: next };
}

export async function deleteAutomationRule(ruleId: string) {
  const session = await requireAutomationAdmin();
  const rules = await readAutomationRules();
  const next = rules.filter((rule) => rule.id !== ruleId);
  await writeAutomationRules(next, session.email);
  revalidatePath(AUTOMATIONS_PATH);
  return { success: true as const, rules: next };
}

// Envoi d'un message de test vers un numero choisi, avec des donnees d'exemple
// (commande fictive) ou les vraies stats du jour pour les regles planifiees.
export async function sendAutomationTest(input: { trigger: AutomationTriggerType; message: string; phone: string }) {
  const session = await requireAutomationAdmin();

  const phone = normalizeIvorianPhone(input.phone || "");
  if (!/^\d{8,15}$/.test(phone)) {
    return { success: false as const, error: "Numéro de test invalide." };
  }
  const message = String(input.message || "").trim();
  if (!message) {
    return { success: false as const, error: "Le message est vide." };
  }

  let variables: Record<string, string>;
  if (input.trigger === "schedule") {
    variables = await buildScheduleVariables();
  } else if (input.trigger === "stock.low") {
    variables = { "{produit}": "Ceinture boucle simple", "{stock}": "3", "{seuil}": "5" };
  } else {
    variables = { ...orderTemplateVariables(SAMPLE_ORDER), "{statut}": "Livrée" };
  }

  return sendWhatsAppContent({
    recipient: phone,
    body: renderTemplate(message, variables),
    byName: `Test automatisation (${session.name})`,
  });
}
