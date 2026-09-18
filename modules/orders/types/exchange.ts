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
// Reading an archived request must not reapply time-dependent submission rules.
const StoredPayloadSchema = z.object({
  ...ExchangeOrderSchema.shape,
  deliveryDate: z.string(),
  customerLocation: z.string().nullish().transform(value => value ?? ""),
});

export const ExchangeCorrectionSchema = z.object({
  deliveryDate: deliveryDate.optional(),
  customerLocation: text.min(1, "Renseignez l’adresse de livraison du nouvel échange.").optional(),
}).strict();
export type ExchangeCorrection = z.infer<typeof ExchangeCorrectionSchema>;

const correctionAuditSchema = z.object({
  previousDeliveryDate: z.string(), previousCustomerLocation: z.string(),
  deliveryDate: z.string(), customerLocation: z.string(),
  at: z.string(), byName: z.string(),
});

export const StoredExchangeRequestSchema = z.object({
  id: z.string().uuid(), orderId: z.string().min(1), orderRef: z.string(),
  commercialId: z.string().min(1), commercialName: z.string(),
  createdAt: z.string(), originalUpdatedAt: z.string(), originalStatus: z.string(),
  originalDeliveryDate: z.string().nullable(), kind: z.literal("EXCHANGE"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]), payload: StoredPayloadSchema,
  reviewedAt: z.string().optional(), reviewedByName: z.string().optional(),
  reviewNote: z.string().optional(), newOrderId: z.string().optional(), newOrderRef: z.string().optional(),
  correction: correctionAuditSchema.optional(),
});

export function exchangeValidationMessage(error: z.ZodError) {
  const fields: Record<string, string> = {
    payload: "Proposition", productId: "Produit", variantId: "Variante", depositTransactionRef: "Référence du paiement",
    customerName: "Nom du client", customerPhone: "Téléphone du client", customerPhone2: "Second téléphone",
    customerLocation: "Adresse du client", commune: "Zone de livraison", deliveryDate: "Date de livraison",
    exchangeReason: "Motif de l’échange", deliveryFee: "Frais de livraison", total: "Total", discount: "Remise",
    paymentMethod: "Moyen de paiement", depositSenderPhone: "Numéro du payeur", items: "Articles",
    size: "Taille", color: "Couleur", name: "Nom", qty: "Quantité", price: "Prix", image: "Image",
  };
  const issue = error.issues[0];
  const location = issue.path.map(part => typeof part === "number" ? `article ${part + 1}` : fields[String(part)] || "Champ").join(" · ");
  // Do not echo unknown property names or supplied values in validation errors.
  const message = issue.code === "unrecognized_keys" ? "seules la date et l’adresse peuvent être corrigées"
    : issue.code === "invalid_type" ? "information manquante ou format incorrect"
    : issue.code === "too_small" ? `valeur trop petite ou contenu incomplet (minimum : ${issue.minimum})`
    : issue.code === "too_big" ? `limite dépassée (maximum : ${issue.maximum})`
    : issue.code === "custom" ? issue.message : "format invalide";
  return `${location || "Demande d’échange"} : ${message}`;
}

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
  correction?: z.infer<typeof correctionAuditSchema>;
};

export const EXCHANGE_PREFIX = "order-exchange:";
