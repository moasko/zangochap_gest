// Stockage des notifications push en CmsContent (comme WhatsApp et les automatisations : pas de migration).
//   push:device:<id>  un enregistrement par appareil (requete par prefixe)
//   push:campaigns    campagnes, la plus recente en tete (bornee)
//   push:settings     reglages et modeles de suivi de commande
//   push:log          journal des envois
//   push:receipts     tickets Expo en attente d'accuse
//   push:daily        compteur quotidien de campagnes par appareil

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from "crypto";
import prisma from "@/lib/prisma";
import { appendCmsLog, readCmsLog } from "@/modules/whatsapp/send";

import {
  DEFAULT_ORDER_TEMPLATES,
  DEFAULT_PUSH_SETTINGS,
  type PushCampaign,
  type PushDevice,
  type PushLogEntry,
  type PushSettings,
} from "./types";

const DEVICE_PREFIX = "push:device:";
const CAMPAIGNS_KEY = "push:campaigns";
const SETTINGS_KEY = "push:settings";
const LOG_KEY = "push:log";
const RECEIPTS_KEY = "push:receipts";
const DAILY_KEY = "push:daily";

const CAMPAIGN_LIMIT = 200;
const RECEIPT_LIMIT = 5000;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.cmsContent.findUnique({ where: { key } });
  return (row?.data as T | undefined) ?? fallback;
}

async function writeJson(key: string, data: unknown, updatedBy = "push") {
  await prisma.cmsContent.upsert({
    where: { key },
    update: { data: data as any, updatedBy },
    create: { key, data: data as any, updatedBy },
  });
}

// Verrou de processus : les ecritures concurrentes d'une meme liste JSON se perdraient.
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(name, next.catch(() => undefined));
  return next;
}

// ============ APPAREILS ============

export function deviceId(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

export async function readDevice(id: string): Promise<PushDevice | null> {
  return readJson<PushDevice | null>(`${DEVICE_PREFIX}${id}`, null);
}

export async function writeDevice(device: PushDevice) {
  await writeJson(`${DEVICE_PREFIX}${device.id}`, device, "mobile-app");
}

export async function readAllDevices(): Promise<PushDevice[]> {
  const rows = await prisma.cmsContent.findMany({ where: { key: { startsWith: DEVICE_PREFIX } }, select: { data: true } });
  return rows.map((row) => row.data as unknown as PushDevice).filter((device) => device && typeof device.token === "string");
}

export async function deactivateDevices(ids: string[], reason: string) {
  for (const id of new Set(ids)) {
    const device = await readDevice(id);
    if (device?.active) await writeDevice({ ...device, active: false, disabledReason: reason });
  }
}

// ============ CAMPAGNES ============

export async function readCampaigns(): Promise<PushCampaign[]> {
  const list = await readJson<PushCampaign[]>(CAMPAIGNS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function updateCampaigns(mutate: (list: PushCampaign[]) => PushCampaign[], updatedBy?: string) {
  return withLock(CAMPAIGNS_KEY, async () => {
    const next = mutate(await readCampaigns());
    // Les campagnes programmees ne sont jamais evincees par la borne.
    const kept = next.filter((c) => c.status === "scheduled" || c.status === "sending");
    const rest = next.filter((c) => c.status !== "scheduled" && c.status !== "sending").slice(0, Math.max(0, CAMPAIGN_LIMIT - kept.length));
    const ordered = [...kept, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    await writeJson(CAMPAIGNS_KEY, ordered, updatedBy);
    return ordered;
  });
}

export async function patchCampaign(id: string, patch: Partial<PushCampaign> | ((campaign: PushCampaign) => Partial<PushCampaign>)) {
  await updateCampaigns((list) =>
    list.map((campaign) => (campaign.id === id ? { ...campaign, ...(typeof patch === "function" ? patch(campaign) : patch) } : campaign)),
  );
}

// ============ REGLAGES ============

export async function readPushSettings(): Promise<PushSettings> {
  const stored = await readJson<Partial<PushSettings> | null>(SETTINGS_KEY, null);
  const value = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULT_PUSH_SETTINGS,
    ...value,
    orderStatus: { ...DEFAULT_ORDER_TEMPLATES, ...(value.orderStatus ?? {}) },
  };
}

export async function writePushSettings(settings: PushSettings, updatedBy?: string) {
  await writeJson(SETTINGS_KEY, settings, updatedBy);
}

// ============ JOURNAL ============

export async function appendPushLog(entry: PushLogEntry) {
  await withLock(LOG_KEY, () => appendCmsLog(LOG_KEY, entry as unknown as Record<string, unknown>));
}

export async function readPushLog(): Promise<PushLogEntry[]> {
  return (await readCmsLog(LOG_KEY)) as unknown as PushLogEntry[];
}

// ============ ACCUSES ============

export type PendingReceipt = { id: string; deviceId: string; at: string };

export async function addPendingReceipts(receipts: PendingReceipt[]) {
  if (!receipts.length) return;
  await withLock(RECEIPTS_KEY, async () => {
    const list = await readJson<PendingReceipt[]>(RECEIPTS_KEY, []);
    await writeJson(RECEIPTS_KEY, [...receipts, ...(Array.isArray(list) ? list : [])].slice(0, RECEIPT_LIMIT));
  });
}

/** Retire et renvoie les tickets assez anciens pour avoir un accuse (15 min). */
export async function takeDueReceipts(olderThanMs = 15 * 60_000): Promise<PendingReceipt[]> {
  return withLock(RECEIPTS_KEY, async () => {
    const list = await readJson<PendingReceipt[]>(RECEIPTS_KEY, []);
    if (!Array.isArray(list) || !list.length) return [];
    const limit = new Date(Date.now() - olderThanMs).toISOString();
    const due = list.filter((receipt) => receipt.at <= limit);
    if (due.length) await writeJson(RECEIPTS_KEY, list.filter((receipt) => receipt.at > limit));
    return due;
  });
}

// ============ PLAFOND QUOTIDIEN ============

type Daily = { date: string; counts: Record<string, number> };

export async function readDailyCounts(today: string): Promise<Record<string, number>> {
  const daily = await readJson<Daily | null>(DAILY_KEY, null);
  return daily?.date === today ? daily.counts : {};
}

export async function bumpDailyCounts(today: string, ids: string[]) {
  if (!ids.length) return;
  await withLock(DAILY_KEY, async () => {
    const daily = await readJson<Daily | null>(DAILY_KEY, null);
    const counts = daily?.date === today ? { ...daily.counts } : {};
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    await writeJson(DAILY_KEY, { date: today, counts });
  });
}
