import { z } from "zod";

const money = z.number().int().min(0).max(100_000_000);
const text = z.string().trim().max(2_000);
const optionalText = text.optional();

export function parseExchangeDate(value: string) {
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
  try { parseExchangeDate(value); return true; } catch { return false; }
}, "Choisissez une date de livraison valide, aujourd'hui ou après.");

export const ExchangeOrderSchema = z.object({
  customerName: text.min(2),
  customerPhone: text.min(8),
  customerPhone2: optionalText,
  customerLocation: text.min(1, "Renseignez l’adresse de livraison du nouvel échange."),
  commune: text.min(1),
  deliveryFee: money.default(0),
  deliveryNote: optionalText,
  deliveryDate,
  total: money.optional(),
  discount: money.default(0),
  promoCode: optionalText,
  notes: optionalText,
  exchangeReason: text.min(1, "Indiquez le motif de l’échange."),
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
}).superRefine((data, context) => {
  const requiresPayment = data.commune.toLowerCase() === "hors abidjan" || data.isPaid === true
    || (data.isPaid !== false && Boolean(data.paymentMethod?.trim()));
  if (requiresPayment && !data.paymentMethod?.trim()) {
    context.addIssue({ code: "custom", path: ["paymentMethod"], message: "Indiquez le moyen de paiement pour cet échange." });
  }
  if (requiresPayment && !String(data.depositSenderPhone || "").replace(/\D/g, "")) {
    context.addIssue({ code: "custom", path: ["depositSenderPhone"], message: "Indiquez le numéro du payeur pour cet échange." });
  }
});

export type ExchangeOrderInput = z.infer<typeof ExchangeOrderSchema>;
export type ExchangeRequest = {
  id: string;
  orderId: string;
  orderRef: string;
  commercialId: string;
  commercialName: string;
  createdAt: string;
  originalUpdatedAt: string;
  originalStatus: string;
  originalDeliveryDate: string | null;
  kind: "EXCHANGE";
  status: "PENDING" | "APPROVED" | "REJECTED";
  payload: ExchangeOrderInput;
  reviewedAt?: string;
  reviewedByName?: string;
  reviewNote?: string;
  newOrderId?: string;
  newOrderRef?: string;
};

export const EXCHANGE_PREFIX = "order-exchange:";
