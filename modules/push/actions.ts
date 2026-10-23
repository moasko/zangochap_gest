"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ensureAuth } from "@/lib/auth";
import { getCatalog, getPublicCategories, queryCatalog } from "@/modules/mobile-api/catalog";
import { hrefToTarget } from "@/modules/mobile-api/home";

import { devicesOverview, resolveAudience, sendCampaign, sendTestPush } from "./engine";
import { patchCampaign, readCampaigns, readPushLog, readPushSettings, updateCampaigns, writePushSettings } from "./store";
import { BODY_MAX, ORDER_PUSH_STATUSES, TITLE_MAX, type PushCampaign, type PushSettings, type PushTarget } from "./types";

const PUSH_PATH = "/zangochap-manager/admin/push";

async function requirePushAdmin() {
  return ensureAuth(["admin", "developer"]);
}

const TargetSchema: z.ZodType<PushTarget> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("home") }),
  z.object({ type: z.literal("collection"), key: z.string().trim().min(1).max(40), title: z.string().trim().max(60).optional() }),
  z.object({ type: z.literal("category"), id: z.string().trim().min(1).max(60), name: z.string().trim().max(80).optional() }),
  z.object({ type: z.literal("product"), id: z.string().trim().min(1).max(120), name: z.string().trim().max(160).optional() }),
  z.object({ type: z.literal("order"), id: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("url"), url: z.string().trim().url("Lien invalide (https://...).").max(500) }),
]);

const AudienceSchema = z.object({
  kind: z.enum(["all", "platform", "phones", "customers", "inactive"]),
  platform: z.enum(["ios", "android", "web"]).optional(),
  phones: z.array(z.string().trim().min(8).max(20)).max(500).optional(),
  orderedWithinDays: z.number().int().min(1).max(365).optional(),
  inactiveDays: z.number().int().min(1).max(365).optional(),
});

const CampaignInputSchema = z.object({
  id: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1, "Ajoutez un titre.").max(TITLE_MAX),
  body: z.string().trim().min(1, "Ajoutez un message.").max(BODY_MAX),
  image: z.string().trim().url("Image : lien https invalide.").max(500).nullish().or(z.literal("")),
  target: TargetSchema,
  audience: AudienceSchema,
  mode: z.enum(["draft", "now", "schedule"]),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
});

export type PushCampaignInput = z.infer<typeof CampaignInputSchema>;

type Result<T = undefined> = { success: true; data?: T } | { success: false; error: string };

function failure(error: unknown): { success: false; error: string } {
  if (error instanceof z.ZodError) return { success: false, error: error.issues[0]?.message || "Données invalides." };
  return { success: false, error: error instanceof Error ? error.message : "Erreur inattendue." };
}

export async function getPushConsoleData() {
  await requirePushAdmin();
  const [settings, campaigns, log, overview, categories] = await Promise.all([
    readPushSettings(),
    readCampaigns(),
    readPushLog(),
    devicesOverview(),
    getPublicCategories().catch(() => []),
  ]);
  return {
    settings,
    campaigns,
    log: log.slice(0, 60),
    overview,
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
    expoTokenConfigured: Boolean(process.env.EXPO_ACCESS_TOKEN),
  };
}

export async function savePushCampaign(input: PushCampaignInput): Promise<Result<{ id: string; status: PushCampaign["status"]; sent?: number }>> {
  try {
    const session = await requirePushAdmin();
    const data = CampaignInputSchema.parse(input);
    if (data.audience.kind === "phones" && !data.audience.phones?.length) throw new Error("Ajoutez au moins un numéro.");
    let scheduledAt: string | null = null;
    if (data.mode === "schedule") {
      if (!data.scheduledAt) throw new Error("Choisissez la date d'envoi.");
      const at = new Date(data.scheduledAt);
      if (at.getTime() < Date.now() - 60_000) throw new Error("La date d'envoi est passée.");
      scheduledAt = at.toISOString();
    }

    const id = data.id || randomUUID();
    const now = new Date().toISOString();
    const status: PushCampaign["status"] = data.mode === "schedule" ? "scheduled" : "draft";
    let editable = true;
    await updateCampaigns((list) => {
      const existing = list.find((campaign) => campaign.id === id);
      if (existing && !["draft", "scheduled"].includes(existing.status)) {
        editable = false;
        return list;
      }
      const campaign: PushCampaign = {
        id,
        title: data.title,
        body: data.body,
        image: data.image || null,
        target: data.target,
        audience: data.audience,
        status,
        scheduledAt,
        sentAt: null,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? session.name ?? null,
        stats: existing?.stats ?? { targeted: 0, sent: 0, failed: 0, opened: 0 },
        error: null,
      };
      return existing ? list.map((item) => (item.id === id ? campaign : item)) : [campaign, ...list];
    }, session.name);
    if (!editable) throw new Error("Cette campagne a déjà été envoyée : dupliquez-la pour la renvoyer.");

    if (data.mode === "now") {
      const result = await sendCampaign(id);
      revalidatePath(PUSH_PATH);
      if (!result) return { success: false, error: "Envoi impossible." };
      if (result.sent === 0) return { success: false, error: result.errors[0] || "Aucun appareil dans l'audience." };
      return { success: true, data: { id, status: "sent", sent: result.sent } };
    }
    revalidatePath(PUSH_PATH);
    return { success: true, data: { id, status } };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelPushCampaign(id: string): Promise<Result> {
  try {
    await requirePushAdmin();
    await patchCampaign(id, (campaign) => (campaign.status === "scheduled" ? { status: "cancelled" } : {}));
    revalidatePath(PUSH_PATH);
    return { success: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deletePushCampaign(id: string): Promise<Result> {
  try {
    const session = await requirePushAdmin();
    // Seuls les brouillons et campagnes annulees disparaissent : l'historique des envois est conserve.
    await updateCampaigns((list) => list.filter((campaign) => !(campaign.id === id && ["draft", "cancelled"].includes(campaign.status))), session.name);
    revalidatePath(PUSH_PATH);
    return { success: true };
  } catch (error) {
    return failure(error);
  }
}

export async function previewPushAudience(audience: z.infer<typeof AudienceSchema>): Promise<Result<{ count: number; afterLimit: number }>> {
  try {
    await requirePushAdmin();
    const parsed = AudienceSchema.parse(audience);
    const [all, limited] = await Promise.all([resolveAudience(parsed), resolveAudience(parsed, { applyDailyLimit: true })]);
    return { success: true, data: { count: all.length, afterLimit: limited.length } };
  } catch (error) {
    return failure(error);
  }
}

const TestSchema = z.object({
  phone: z.string().trim().max(20).optional(),
  deviceId: z.string().trim().max(40).optional(),
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().min(1).max(BODY_MAX),
  image: z.string().trim().url().max(500).nullish().or(z.literal("")),
  target: TargetSchema,
});

export async function sendPushTest(input: z.infer<typeof TestSchema>): Promise<Result<{ sent: number }>> {
  try {
    await requirePushAdmin();
    const data = TestSchema.parse(input);
    if (!data.phone && !data.deviceId) throw new Error("Indiquez le numéro du téléphone de test.");
    const result = await sendTestPush({ ...data, image: data.image || null });
    revalidatePath(PUSH_PATH);
    return result.sent ? { success: true, data: { sent: result.sent } } : { success: false, error: result.error || "Envoi refusé." };
  } catch (error) {
    return failure(error);
  }
}

const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:mm).");

const SettingsSchema = z.object({
  enabled: z.boolean(),
  quietHoursEnabled: z.boolean(),
  sendStart: HM,
  sendEnd: HM,
  dailyLimitPerDevice: z.number().int().min(0).max(20),
  orderStatus: z.record(
    z.enum(ORDER_PUSH_STATUSES),
    z.object({ enabled: z.boolean(), title: z.string().trim().min(1).max(TITLE_MAX), body: z.string().trim().min(1).max(BODY_MAX) }),
  ),
});

export async function updatePushSettings(input: PushSettings): Promise<Result> {
  try {
    const session = await requirePushAdmin();
    const data = SettingsSchema.parse(input);
    await writePushSettings(data as PushSettings, session.name);
    revalidatePath(PUSH_PATH);
    return { success: true };
  } catch (error) {
    return failure(error);
  }
}

export async function searchPushProducts(q: string) {
  await requirePushAdmin();
  const query = String(q || "").trim().slice(0, 80);
  if (query.length < 2) return [];
  const { items } = queryCatalog(await getCatalog(), { q: query, sort: "relevance", pageSize: 8 });
  return items.map((item) => ({ id: item.id, name: item.name, price: item.price, image: item.image }));
}

/** Traduit un lien du site (« /product/x », « /shop?category=... ») en cible de l'app. */
export async function resolvePushLink(href: string): Promise<PushTarget> {
  await requirePushAdmin();
  const target = hrefToTarget(href, await getPublicCategories());
  return target.type === "collection" ? { type: "collection", key: target.key, title: target.title } : target;
}
