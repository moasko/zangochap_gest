// Enregistrement des appareils pour les notifications push et mesure des ouvertures.
import { z } from "zod";

export const registerPushSchema = z.object({
  token: z.string().trim().min(10).max(200),
  platform: z.enum(["ios", "android", "web"]),
  appVersion: z.string().trim().max(30).nullish(),
  topics: z.object({ orders: z.boolean(), promotions: z.boolean(), cartReminders: z.boolean() }).partial().optional(),
  phones: z.array(z.string().trim().max(20)).max(10).optional(),
  orderIds: z.array(z.string().trim().max(60)).max(50).optional(),
});

export const unregisterPushSchema = z.object({ token: z.string().trim().min(10).max(200) });

export const openedPushSchema = z.object({ campaignId: z.string().trim().min(1).max(60) });
