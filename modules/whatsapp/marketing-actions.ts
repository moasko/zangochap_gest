"use server";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { customerTemplateVariables, renderTemplate } from "./message-builder";
import { sendWhatsAppContent } from "./send";

const WHATSAPP_PATH = "/zangochap-manager/admin/whatsapp";
const MODELS_KEY = "whatsapp:marketing-models";
const GROUPS_KEY = "whatsapp:contact-groups";
// Limite par diffusion : protege la qualite du numero aupres de Meta et evite
// les timeouts de server action (envois sequentiels).
const BROADCAST_LIMIT = 50;
// Taille maximum d'un groupe (statique ou resolu depuis des regles).
const GROUP_MEMBER_LIMIT = 500;

const ModelSchema = z.object({
  id: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2).max(80),
  body: z.string().trim().min(5).max(4096),
});

const BroadcastSchema = z.object({
  body: z.string().trim().min(5).max(4096),
  imageUrl: z.string().trim().url().max(1000).optional(),
  customerIds: z.array(z.string().trim().min(1)).min(1).max(BROADCAST_LIMIT),
});

// Regles d'un groupe intelligent : combinables entre elles (ET logique).
const SmartRulesSchema = z.object({
  communes: z.array(z.string().trim().min(1)).max(40).optional(),
  minOrders: z.number().int().min(0).max(100000).optional(),
  minSpent: z.number().int().min(0).max(1_000_000_000).optional(),
  maxSpent: z.number().int().min(0).max(1_000_000_000).optional(),
  // Actifs : derniere commande dans les N derniers jours.
  activeWithinDays: z.number().int().min(1).max(3650).optional(),
  // Inactifs : aucune commande depuis N jours (relance).
  inactiveForDays: z.number().int().min(1).max(3650).optional(),
  sortBy: z.enum(["recent", "spent", "orders", "name"]).optional(),
  limit: z.number().int().min(1).max(GROUP_MEMBER_LIMIT).optional(),
});

const GroupSchema = z.object({
  id: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2).max(80),
  type: z.enum(["STATIC", "SMART"]),
  customerIds: z.array(z.string().trim().min(1)).max(GROUP_MEMBER_LIMIT).optional(),
  rules: SmartRulesSchema.optional(),
}).refine(
  (group) => group.type === "STATIC" ? (group.customerIds?.length || 0) > 0 : Boolean(group.rules),
  { message: "Un groupe statique exige des clients, un groupe intelligent exige des règles." },
);

type SmartRules = z.infer<typeof SmartRulesSchema>;

const MEMBER_SELECT = {
  id: true,
  name: true,
  phone: true,
  commune: true,
  totalOrders: true,
  totalSpent: true,
  lastOrderAt: true,
} as const;

function smartWhere(rules: SmartRules) {
  const where: any = {};
  if (rules.communes?.length) where.commune = { in: rules.communes };
  if (rules.minOrders) where.totalOrders = { gte: rules.minOrders };
  if (rules.minSpent || rules.maxSpent) {
    where.totalSpent = {
      ...(rules.minSpent ? { gte: rules.minSpent } : {}),
      ...(rules.maxSpent ? { lte: rules.maxSpent } : {}),
    };
  }
  if (rules.activeWithinDays) {
    where.lastOrderAt = { gte: new Date(Date.now() - rules.activeWithinDays * 86_400_000) };
  }
  if (rules.inactiveForDays) {
    where.lastOrderAt = { ...(where.lastOrderAt || {}), lte: new Date(Date.now() - rules.inactiveForDays * 86_400_000) };
  }
  return where;
}

function smartOrderBy(sortBy?: SmartRules["sortBy"]) {
  if (sortBy === "spent") return { totalSpent: "desc" as const };
  if (sortBy === "orders") return { totalOrders: "desc" as const };
  if (sortBy === "name") return { name: "asc" as const };
  return { lastOrderAt: "desc" as const };
}

async function readGroups(): Promise<any[]> {
  const row = await prisma.cmsContent.findUnique({ where: { key: GROUPS_KEY } });
  return Array.isArray(row?.data) ? (row.data as any[]) : [];
}

async function writeGroups(groups: any[], updatedBy?: string) {
  await prisma.cmsContent.upsert({
    where: { key: GROUPS_KEY },
    update: { data: groups as Prisma.InputJsonArray, updatedBy },
    create: { key: GROUPS_KEY, data: groups as Prisma.InputJsonArray, updatedBy },
  });
}

async function resolveGroupMembers(group: any) {
  if (group.type === "SMART") {
    const rules: SmartRules = group.rules || {};
    return prisma.customer.findMany({
      where: smartWhere(rules),
      select: MEMBER_SELECT,
      orderBy: smartOrderBy(rules.sortBy),
      take: rules.limit || GROUP_MEMBER_LIMIT,
    });
  }
  const ids: string[] = Array.isArray(group.customerIds) ? group.customerIds : [];
  return prisma.customer.findMany({
    where: { id: { in: ids } },
    select: MEMBER_SELECT,
    orderBy: { name: "asc" },
  });
}

async function requireMarketingUser() {
  return ensureAuth(["admin", "developer"]);
}

async function readModels(): Promise<any[]> {
  const row = await prisma.cmsContent.findUnique({ where: { key: MODELS_KEY } });
  return Array.isArray(row?.data) ? (row.data as any[]) : [];
}

async function writeModels(models: any[], updatedBy?: string) {
  await prisma.cmsContent.upsert({
    where: { key: MODELS_KEY },
    update: { data: models as Prisma.InputJsonArray, updatedBy },
    create: { key: MODELS_KEY, data: models as Prisma.InputJsonArray, updatedBy },
  });
}

export async function getMarketingWorkspace() {
  await requireMarketingUser();
  const [models, customers, groupsRaw, communeRows] = await Promise.all([
    readModels(),
    prisma.customer.findMany({
      select: MEMBER_SELECT,
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    readGroups(),
    prisma.customer.findMany({
      where: { commune: { not: null } },
      distinct: ["commune"],
      select: { commune: true },
      take: 100,
    }),
  ]);

  // Effectif de chaque groupe : compte live pour les intelligents.
  const groups = await Promise.all(groupsRaw.map(async (group: any) => ({
    ...group,
    memberCount: group.type === "SMART"
      ? await prisma.customer.count({ where: smartWhere(group.rules || {}) })
      : (Array.isArray(group.customerIds) ? group.customerIds.length : 0),
  })));

  const communes = communeRows
    .map((row: any) => row.commune)
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b));

  return JSON.parse(JSON.stringify({ models, customers, groups, communes }));
}

// Previsualisation d'un segment intelligent avant enregistrement.
export async function previewSmartGroup(input: unknown) {
  await requireMarketingUser();
  const parsed = SmartRulesSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: "Règles de segment invalides." };

  const where = smartWhere(parsed.data);
  const [count, members] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      select: MEMBER_SELECT,
      orderBy: smartOrderBy(parsed.data.sortBy),
      take: Math.min(parsed.data.limit || 100, 100),
    }),
  ]);

  return JSON.parse(JSON.stringify({ success: true as const, count, members }));
}

export async function saveContactGroup(input: unknown) {
  const session = await requireMarketingUser();
  const parsed = GroupSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message || "Groupe invalide." };
  }

  const groups = await readGroups();
  const now = new Date().toISOString();

  if (parsed.data.id) {
    const index = groups.findIndex((group) => group.id === parsed.data.id);
    if (index === -1) return { success: false as const, error: "Groupe introuvable." };
    groups[index] = {
      ...groups[index],
      name: parsed.data.name,
      type: parsed.data.type,
      customerIds: parsed.data.type === "STATIC" ? parsed.data.customerIds : undefined,
      rules: parsed.data.type === "SMART" ? parsed.data.rules : undefined,
      updatedAt: now,
      updatedByName: session.name,
    };
  } else {
    groups.unshift({
      id: `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name: parsed.data.name,
      type: parsed.data.type,
      customerIds: parsed.data.type === "STATIC" ? parsed.data.customerIds : undefined,
      rules: parsed.data.type === "SMART" ? parsed.data.rules : undefined,
      createdAt: now,
      updatedAt: now,
      updatedByName: session.name,
    });
  }

  await writeGroups(groups.slice(0, 50), session.email);
  revalidatePath(WHATSAPP_PATH);
  return { success: true as const };
}

export async function deleteContactGroup(id: string) {
  const session = await requireMarketingUser();
  const groups = await readGroups();
  const next = groups.filter((group) => group.id !== id);
  if (next.length === groups.length) return { success: false as const, error: "Groupe introuvable." };
  await writeGroups(next, session.email);
  revalidatePath(WHATSAPP_PATH);
  return { success: true as const };
}

// Resout les membres d'un groupe (regles evaluees en direct pour les
// intelligents) : utilise pour charger une diffusion.
export async function getContactGroupMembers(groupId: string) {
  await requireMarketingUser();
  const groups = await readGroups();
  const group = groups.find((item) => item.id === groupId);
  if (!group) return { success: false as const, error: "Groupe introuvable." };
  const members = await resolveGroupMembers(group);
  return JSON.parse(JSON.stringify({ success: true as const, group: { id: group.id, name: group.name, type: group.type }, members }));
}

export async function saveMarketingModel(input: unknown) {
  const session = await requireMarketingUser();
  const parsed = ModelSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: "Nom (2 caractères min.) et message (5 caractères min.) requis." };

  const models = await readModels();
  const now = new Date().toISOString();

  if (parsed.data.id) {
    const index = models.findIndex((model) => model.id === parsed.data.id);
    if (index === -1) return { success: false as const, error: "Modèle introuvable." };
    models[index] = { ...models[index], name: parsed.data.name, body: parsed.data.body, updatedAt: now, updatedByName: session.name };
  } else {
    models.unshift({
      // Identifiant simple sans dependance : suffisant pour une liste en CmsContent.
      id: `mdl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name: parsed.data.name,
      body: parsed.data.body,
      createdAt: now,
      updatedAt: now,
      updatedByName: session.name,
    });
  }

  await writeModels(models.slice(0, 50), session.email);
  revalidatePath(WHATSAPP_PATH);
  return { success: true as const };
}

export async function deleteMarketingModel(id: string) {
  const session = await requireMarketingUser();
  const models = await readModels();
  const next = models.filter((model) => model.id !== id);
  if (next.length === models.length) return { success: false as const, error: "Modèle introuvable." };
  await writeModels(next, session.email);
  revalidatePath(WHATSAPP_PATH);
  return { success: true as const };
}

// Diffusion groupee : rend le message par client ({client}, {nom}, {prenom},
// {telephone}) et envoie sequentiellement. Chaque envoi (succes/echec) est
// journalise dans l'onglet Activite via sendWhatsAppText.
export async function sendMarketingBroadcast(input: unknown) {
  const session = await requireMarketingUser();
  const parsed = BroadcastSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: `Message et destinataires requis (maximum ${BROADCAST_LIMIT} clients par envoi).` };

  const customers = await prisma.customer.findMany({
    where: { id: { in: parsed.data.customerIds } },
    select: { id: true, name: true, phone: true },
  });
  if (customers.length === 0) return { success: false as const, error: "Aucun client valide sélectionné." };

  let sent = 0;
  const failures: Array<{ name: string; phone: string; error: string }> = [];

  for (const customer of customers) {
    if (!customer.phone) {
      failures.push({ name: customer.name || "?", phone: "—", error: "Numéro manquant." });
      continue;
    }
    const body = renderTemplate(parsed.data.body, customerTemplateVariables(customer));
    const result = await sendWhatsAppContent({
      recipient: customer.phone,
      body,
      imageUrl: parsed.data.imageUrl || null,
      byName: `${session.name} (diffusion)`,
    });
    if (result.success) sent += 1;
    else failures.push({ name: customer.name || "?", phone: customer.phone, error: result.error });
  }

  revalidatePath(WHATSAPP_PATH);
  return { success: true as const, sent, failed: failures.length, failures: failures.slice(0, 10) };
}
