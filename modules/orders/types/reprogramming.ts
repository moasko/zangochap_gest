import { z } from "zod";

const money = z.number().int().min(0).max(100_000_000);
const text = z.string().trim().max(2_000);
const optionalText = text.optional();

export function parseReprogrammingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date de livraison invalide.");
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    throw new Error("Date de livraison invalide.");
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) throw new Error("La date de livraison ne peut pas être dans le passé.");
  return date;
}

const deliveryDate = z.string().refine(value => {
  try { parseReprogrammingDate(value); return true; } catch { return false; }
}, "Choisissez une date de livraison valide, aujourd'hui ou après.");

export const ReprogramOrderSchema = z.object({
  customerName: text.min(2),
  customerPhone: text.min(8),
  customerPhone2: optionalText,
  customerLocation: text.min(1),
  commune: text.min(1),
  deliveryFee: money.default(0),
  deliveryNote: optionalText,
  deliveryDate,
  total: money.optional(),
  discount: money.default(0),
  promoCode: optionalText,
  notes: optionalText,
  reason: text.min(1, "Indiquez le motif de la reprogrammation."),
  paymentMethod: optionalText,
  depositSenderPhone: optionalText,
  depositTransactionRef: optionalText,
  isPaid: z.boolean().optional(),
  giftRequestReason: optionalText,
  items: z.array(z.object({
    productId: z.string().max(200).nullish().transform(value => value || undefined),
    variantId: z.string().max(200).nullish().transform(value => value || undefined),
    name: text.min(1),
    size: text,
    color: text,
    qty: z.number().int().min(1).max(10_000),
    price: money,
    originalPrice: money.optional(),
    emoji: z.string().max(50).optional(),
    image: z.string().max(10_000_000).nullish().transform(value => value || undefined),
    isCustom: z.boolean().optional(),
    isGift: z.boolean().optional(),
    notes: optionalText,
    desc: optionalText,
  }).refine(item => !item.isCustom || Boolean(item.image), "Une image est obligatoire pour un article personnalisé.")).min(1).max(100),
});

export const ReproDispoSchema = z.object({ deliveryDate, reason: text.min(1) });
export type ReprogramOrderInput = z.infer<typeof ReprogramOrderSchema>;
export type ReprogrammingRequest = {
  id: string;
  orderId: string;
  orderRef: string;
  commercialId: string;
  commercialName: string;
  createdAt: string;
  originalUpdatedAt: string;
  originalStatus: string;
  originalDeliveryDate: string | null;
  kind: "NEW_ORDER" | "REPRO_DISPO";
  status: "PENDING" | "APPROVED" | "REJECTED";
  payload: ReprogramOrderInput | z.infer<typeof ReproDispoSchema>;
  reviewedAt?: string;
  reviewedByName?: string;
  reviewNote?: string;
  newOrderId?: string;
  newOrderRef?: string;
};

export const REPROGRAMMING_PREFIX = "order-reprogramming:";
