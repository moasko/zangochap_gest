// Moteur des notifications push de l'application mobile : enregistrement des appareils,
// campagnes (immediates ou programmees), suivi de commande automatique, accuses Expo.
// Pas un module "use server" : importe par les server actions, l'API mobile, le moteur
// d'automatisations et le planificateur. Tout est best-effort : un echec d'envoi ne
// doit jamais faire echouer le flux metier qui l'a declenche.

/* eslint-disable @typescript-eslint/no-explicit-any */

import prisma from "@/lib/prisma";
import { normalizeIvorianPhone, renderTemplate } from "@/modules/whatsapp/message-builder";

import { type ExpoMessage, getExpoReceipts, isExpoPushToken, sendExpoMessages } from "./expo";
import {
  addPendingReceipts,
  appendPushLog,
  bumpDailyCounts,
  deactivateDevices,
  deviceId,
  patchCampaign,
  readAllDevices,
  readCampaigns,
  readDailyCounts,
  readDevice,
  readPushSettings,
  takeDueReceipts,
  writeDevice,
} from "./store";
import {
  type PushAudience,
  type PushCampaign,
  type PushDevice,
  type PushPlatform,
  type PushSettings,
  type PushTarget,
  type PushTopic,
} from "./types";

const ORDER_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Confirmée",
  PREPARING: "En préparation",
  PACKED: "Emballée",
  ON_DELIVERY: "En livraison",
  DELIVERED: "Livrée",
  PARTIALLY_DELIVERED: "Livrée partiellement",
  REPROGRAMMED: "Reprogrammée",
  CANCELLED: "Annulée",
};

// Abidjan = UTC toute l'annee.
function abidjanClock(now = new Date()) {
  const iso = now.toISOString();
  return { today: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

function withinWindow(settings: PushSettings, hm: string) {
  if (!settings.quietHoursEnabled) return true;
  return settings.sendStart <= settings.sendEnd
    ? hm >= settings.sendStart && hm < settings.sendEnd
    : hm >= settings.sendStart || hm < settings.sendEnd;
}

export function orderNumber(order: { id: string; ref?: string | null }) {
  return order.ref || `#${String(order.id).slice(-6).toUpperCase()}`;
}

// ============ APPAREILS ============

export type RegisterInput = {
  token: string;
  platform: PushPlatform;
  appVersion?: string | null;
  topics?: Partial<Record<PushTopic, boolean>>;
  phones?: string[];
  orderIds?: string[];
};

export async function registerDevice(input: RegisterInput) {
  if (!isExpoPushToken(input.token)) throw new Error("Jeton de notification invalide.");
  const id = deviceId(input.token);
  const existing = await readDevice(id);
  const now = new Date().toISOString();
  const phones = Array.from(new Set([...(existing?.phones ?? []), ...(input.phones ?? []).map(normalizeIvorianPhone).filter((p) => p.length >= 11)])).slice(-10);
  const orderIds = Array.from(new Set([...(existing?.orderIds ?? []), ...(input.orderIds ?? [])])).slice(-50);
  const device: PushDevice = {
    id,
    token: input.token,
    platform: input.platform,
    appVersion: input.appVersion ?? existing?.appVersion ?? null,
    topics: {
      orders: input.topics?.orders ?? existing?.topics.orders ?? true,
      promotions: input.topics?.promotions ?? existing?.topics.promotions ?? true,
      cartReminders: input.topics?.cartReminders ?? existing?.topics.cartReminders ?? true,
    },
    phones,
    orderIds,
    active: true,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    disabledReason: null,
  };
  await writeDevice(device);
  return { id, topics: device.topics };
}

export async function unregisterDevice(token: string) {
  if (!isExpoPushToken(token)) return;
  const device = await readDevice(deviceId(token));
  if (device) await writeDevice({ ...device, active: false, disabledReason: "Désactivé depuis l'application" });
}

// ============ ENVOI ============

type Outgoing = { device: PushDevice; title: string; body: string; data: Record<string, unknown>; channelId: string; image?: string | null };

async function deliver(outgoing: Outgoing[]) {
  if (!outgoing.length) return { sent: 0, failed: 0, errors: [] as string[] };
  const messages: ExpoMessage[] = outgoing.map((item) => ({
    to: item.device.token,
    title: item.title,
    body: item.body,
    data: item.data,
    sound: "default",
    channelId: item.channelId,
    priority: "high",
    ...(item.image ? { richContent: { image: item.image } } : {}),
  }));
  const tickets = await sendExpoMessages(messages);
  let sent = 0;
  const errors: string[] = [];
  const unregistered: string[] = [];
  const receipts: Array<{ id: string; deviceId: string; at: string }> = [];
  const at = new Date().toISOString();
  tickets.forEach((ticket, index) => {
    const device = outgoing[index].device;
    if (ticket.status === "ok") {
      sent += 1;
      receipts.push({ id: ticket.id, deviceId: device.id, at });
    } else {
      errors.push(ticket.message);
      if (ticket.details?.error === "DeviceNotRegistered") unregistered.push(device.id);
    }
  });
  await deactivateDevices(unregistered, "Application désinstallée ou notifications retirées");
  await addPendingReceipts(receipts);
  return { sent, failed: outgoing.length - sent, errors };
}

// ============ AUDIENCE ============

export async function resolveAudience(audience: PushAudience, options: { applyDailyLimit?: boolean } = {}) {
  const settings = await readPushSettings();
  const devices = (await readAllDevices()).filter((device) => device.active && device.topics.promotions);
  let selected: PushDevice[] = devices;

  if (audience.kind === "platform" && audience.platform) {
    selected = devices.filter((device) => device.platform === audience.platform);
  } else if (audience.kind === "phones") {
    const wanted = new Set((audience.phones ?? []).map(normalizeIvorianPhone));
    selected = devices.filter((device) => device.phones.some((phone) => wanted.has(phone)));
  } else if (audience.kind === "customers") {
    const since = new Date(Date.now() - Math.max(1, audience.orderedWithinDays ?? 30) * 86_400_000);
    const orders = await prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { customerPhone: true }, distinct: ["customerPhone"] });
    const phones = new Set(orders.map((order) => normalizeIvorianPhone(order.customerPhone || "")).filter(Boolean));
    selected = devices.filter((device) => device.phones.some((phone) => phones.has(phone)));
  } else if (audience.kind === "inactive") {
    const limit = new Date(Date.now() - Math.max(1, audience.inactiveDays ?? 14) * 86_400_000).toISOString();
    selected = devices.filter((device) => device.lastSeenAt < limit);
  }

  if (options.applyDailyLimit && settings.dailyLimitPerDevice > 0) {
    const counts = await readDailyCounts(abidjanClock().today);
    selected = selected.filter((device) => (counts[device.id] ?? 0) < settings.dailyLimitPerDevice);
  }
  return selected;
}

// ============ CAMPAGNES ============

function campaignData(campaign: PushCampaign) {
  return { kind: "campaign", campaignId: campaign.id, target: campaign.target };
}

/** Envoie une campagne (statut « sending » pose avant l'envoi : jamais deux fois). */
export async function sendCampaign(id: string) {
  const campaign = (await readCampaigns()).find((item) => item.id === id);
  if (!campaign || !["draft", "scheduled"].includes(campaign.status)) return null;
  await patchCampaign(id, { status: "sending" });

  try {
    const devices = await resolveAudience(campaign.audience, { applyDailyLimit: true });
    const result = await deliver(
      devices.map((device) => ({ device, title: campaign.title, body: campaign.body, data: campaignData(campaign), channelId: "promotions", image: campaign.image })),
    );
    const { today } = abidjanClock();
    await bumpDailyCounts(today, devices.map((device) => device.id));
    const error = result.sent === 0 && devices.length > 0 ? result.errors[0] ?? "Aucun envoi accepté." : devices.length === 0 ? "Aucun appareil dans l'audience." : null;
    await patchCampaign(id, (current) => ({
      status: result.sent > 0 ? "sent" : "failed",
      sentAt: new Date().toISOString(),
      stats: { ...current.stats, targeted: devices.length, sent: result.sent, failed: result.failed },
      error,
    }));
    await appendPushLog({ at: new Date().toISOString(), kind: "campaign", label: campaign.title, sent: result.sent, failed: result.failed, error });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur d'envoi.";
    await patchCampaign(id, { status: "failed", error: message });
    await appendPushLog({ at: new Date().toISOString(), kind: "campaign", label: campaign.title, sent: 0, failed: 0, error: message });
    return null;
  }
}

/** Campagnes programmees arrivees a echeance (respecte la plage horaire d'envoi). */
export async function processDueCampaigns() {
  const settings = await readPushSettings();
  if (!settings.enabled) return;
  const nowIso = new Date().toISOString();
  if (!withinWindow(settings, abidjanClock().hm)) return;
  const due = (await readCampaigns()).filter((campaign) => campaign.status === "scheduled" && campaign.scheduledAt && campaign.scheduledAt <= nowIso);
  for (const campaign of due) await sendCampaign(campaign.id);
}

export async function recordCampaignOpen(campaignId: string) {
  await patchCampaign(campaignId, (campaign) => ({ stats: { ...campaign.stats, opened: campaign.stats.opened + 1 } }));
}

// ============ SUIVI DE COMMANDE ============

/** Notifie les appareils lies a la commande (numero ou identifiant) selon le modele du statut. */
export async function notifyOrderStatusPush(order: any, toStatus: string) {
  try {
    const settings = await readPushSettings();
    const template = settings.orderStatus[toStatus];
    if (!settings.enabled || !template?.enabled || !order?.id) return;

    const phone = normalizeIvorianPhone(order.customerPhone || "");
    const devices = (await readAllDevices()).filter(
      (device) => device.active && device.topics.orders && (device.orderIds.includes(order.id) || (phone && device.phones.includes(phone))),
    );
    if (!devices.length) return;

    const subtotal = Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0);
    const variables = {
      "{reference}": orderNumber(order),
      "{client}": String(order.customerName || "").trim().split(/\s+/)[0] || "",
      "{montant}": `${new Intl.NumberFormat("fr-FR").format(Math.max(0, Math.round(subtotal)))} FCFA`,
      "{statut}": ORDER_STATUS_LABELS[toStatus] || toStatus,
    };
    const title = renderTemplate(template.title, variables);
    const body = renderTemplate(template.body, variables);
    const result = await deliver(
      devices.map((device) => ({ device, title, body, channelId: "orders", data: { kind: "order", orderId: order.id, target: { type: "order", id: order.id } } })),
    );
    await appendPushLog({ at: new Date().toISOString(), kind: "order", label: `${orderNumber(order)} → ${variables["{statut}"]}`, sent: result.sent, failed: result.failed, error: result.errors[0] ?? null });
  } catch (error) {
    console.error("[push] Notification de commande :", error);
  }
}

// ============ TEST ============

export async function sendTestPush(input: { phone?: string; deviceId?: string; title: string; body: string; target: PushTarget; image?: string | null }) {
  const devices = (await readAllDevices()).filter((device) => device.active);
  const phone = input.phone ? normalizeIvorianPhone(input.phone) : "";
  const recipients = input.deviceId ? devices.filter((device) => device.id === input.deviceId) : devices.filter((device) => phone && device.phones.includes(phone));
  if (!recipients.length) return { sent: 0, failed: 0, error: "Aucun appareil actif pour ce destinataire. Le client doit avoir passé une commande depuis l'app avec ce numéro." };
  const result = await deliver(
    recipients.map((device) => ({ device, title: input.title, body: input.body, image: input.image, channelId: "promotions", data: { kind: "test", target: input.target } })),
  );
  await appendPushLog({ at: new Date().toISOString(), kind: "test", label: input.title, sent: result.sent, failed: result.failed, error: result.errors[0] ?? null });
  return { sent: result.sent, failed: result.failed, error: result.sent ? null : result.errors[0] ?? "Envoi refusé." };
}

// ============ ACCUSES ET PLANIFICATEUR ============

/** Lit les accuses Expo et desactive les appareils qui n'existent plus. */
export async function processReceipts() {
  const due = await takeDueReceipts();
  if (!due.length) return;
  const receipts = await getExpoReceipts(due.map((receipt) => receipt.id));
  const unregistered = due
    .filter((receipt) => {
      const value = receipts[receipt.id];
      return value?.status === "error" && value.details?.error === "DeviceNotRegistered";
    })
    .map((receipt) => receipt.deviceId);
  await deactivateDevices(unregistered, "Application désinstallée ou notifications retirées");
}

/** Appele chaque minute par instrumentation-node.ts. */
export async function runPushTick() {
  try {
    await processDueCampaigns();
    await processReceipts();
  } catch (error) {
    console.error("[push] Tick :", error);
  }
}

export async function devicesOverview() {
  const devices = await readAllDevices();
  const active = devices.filter((device) => device.active);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return {
    total: devices.length,
    active: active.length,
    ios: active.filter((device) => device.platform === "ios").length,
    android: active.filter((device) => device.platform === "android").length,
    promotions: active.filter((device) => device.topics.promotions).length,
    orders: active.filter((device) => device.topics.orders).length,
    linked: active.filter((device) => device.phones.length > 0).length,
    activeThisWeek: active.filter((device) => device.lastSeenAt >= weekAgo).length,
    recent: [...devices]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 30)
      .map((device) => ({
        id: device.id,
        platform: device.platform,
        appVersion: device.appVersion,
        active: device.active,
        topics: device.topics,
        // Numeros masques : la console n'a pas besoin du numero complet.
        phones: device.phones.map((phone) => `${phone.slice(0, 5)}•••${phone.slice(-2)}`),
        lastSeenAt: device.lastSeenAt,
        disabledReason: device.disabledReason ?? null,
      })),
  };
}
