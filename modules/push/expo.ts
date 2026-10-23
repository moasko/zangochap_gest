// Client minimal du service Expo Push (https://docs.expo.dev/push-notifications/sending-notifications/).
// Expo relaie vers FCM (Android) et APNs (iOS) avec les identifiants configures dans EAS.
// EXPO_ACCESS_TOKEN (facultatif) : a definir si la securite des envois push est activee sur le projet Expo.

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK = 100;

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  badge?: number;
  richContent?: { image?: string };
  ttl?: number;
};

export type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

export function isExpoPushToken(token: string) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

function headers() {
  const result: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  const token = process.env.EXPO_ACCESS_TOKEN;
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

/** Envoie par lots de 100 ; renvoie un ticket par message, dans le meme ordre. */
export async function sendExpoMessages(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (let start = 0; start < messages.length; start += CHUNK) {
    const chunk = messages.slice(start, start + CHUNK);
    try {
      const response = await fetch(SEND_URL, { method: "POST", headers: headers(), body: JSON.stringify(chunk), signal: AbortSignal.timeout(20_000) });
      const payload = (await response.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: Array<{ message?: string }> } | null;
      if (!response.ok || !Array.isArray(payload?.data)) {
        const message = payload?.errors?.[0]?.message || `Service Expo indisponible (HTTP ${response.status}).`;
        chunk.forEach(() => tickets.push({ status: "error", message }));
        continue;
      }
      chunk.forEach((_, index) => tickets.push(payload.data![index] ?? { status: "error", message: "Ticket manquant." }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur reseau vers Expo.";
      chunk.forEach(() => tickets.push({ status: "error", message }));
    }
  }
  return tickets;
}

export type ExpoReceipt = { status: "ok" } | { status: "error"; message?: string; details?: { error?: string } };

/** Accuses de livraison (disponibles ~15 min apres l'envoi) : signalent les appareils desinstalles. */
export async function getExpoReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const receipts: Record<string, ExpoReceipt> = {};
  for (let start = 0; start < ids.length; start += 300) {
    const chunk = ids.slice(start, start + 300);
    try {
      const response = await fetch(RECEIPTS_URL, { method: "POST", headers: headers(), body: JSON.stringify({ ids: chunk }), signal: AbortSignal.timeout(20_000) });
      const payload = (await response.json().catch(() => null)) as { data?: Record<string, ExpoReceipt> } | null;
      Object.assign(receipts, payload?.data ?? {});
    } catch {
      // Accuses relus au prochain passage.
    }
  }
  return receipts;
}
