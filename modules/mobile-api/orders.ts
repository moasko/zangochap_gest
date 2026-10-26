// Panier, remises, creation et suivi de commande pour l'API mobile. Module interne.
// Le serveur fait autorite : prix (base), frais (commune), remise (moteur promo) et total sont
// recalcules ici ; les montants envoyes par l'application ne sont jamais repris.
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getBestAutomaticDiscount, validatePromoCode, type CartItem } from "@/lib/promo-engine";
import { createOrderWithContext } from "@/modules/orders/actions/order-creation-service";

import { absoluteImage, publicProductWhere } from "./catalog";
import { findZone } from "./delivery";
import { MobileApiError } from "./errors";

// ---------- Schemas d'entree ----------

const lineSchema = z.object({
  key: z.string().max(200).optional(),
  productId: z.string().min(1).max(64),
  variantId: z.string().min(1).max(64).nullable(),
  qty: z.number().int().min(1).max(10),
  // Prix vu par l application (detection « prix change ») ; jamais utilise pour facturer.
  unitPrice: z.number().nonnegative().optional(),
});

export const cartValidationSchema = z.object({ lines: z.array(lineSchema).min(1).max(50) });

export const promoValidationSchema = z.object({
  code: z.string().trim().min(2).max(40),
  lines: z.array(lineSchema).min(1).max(50),
  commune: z.string().max(80).nullable().optional(),
  phone: z.string().max(20).optional(),
});

export const createOrderSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().max(20),
    phone2: z.string().max(20).nullable().optional(),
  }),
  delivery: z.object({
    mode: z.enum(["delivery", "pickup"]),
    commune: z.string().max(80),
    address: z.string().trim().max(200),
    landmark: z.string().trim().max(200),
    relayPoint: z.string().trim().max(120).nullable().optional(),
  }),
  notes: z.string().trim().max(500).nullable().optional(),
  paymentMethod: z.literal("cod"),
  promoCode: z.string().trim().max(40).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(50),
  expectedTotal: z.number().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ---------- Telephones ----------

/** 10 chiffres ivoiriens (01/05/07 mobiles, 21/25/27 fixes), avec ou sans +225. */
export function normalizeCiPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("225") && digits.length === 13 ? digits.slice(3) : digits;
}

export function isValidCiPhone(value: string) {
  return /^(01|05|07|21|25|27)\d{8}$/.test(normalizeCiPhone(value));
}

// ---------- Lignes resolues depuis la base ----------

type ResolvedLine = {
  key: string;
  productId: string;
  variantId: string | null;
  categoryId: string | null;
  name: string;
  size: string;
  color: string;
  image: string | null;
  unitPrice: number;
  stock: number;
  qty: number;
  available: boolean;
};

async function resolveLines(lines: z.infer<typeof lineSchema>[]): Promise<ResolvedLine[]> {
  const products = await prisma.product.findMany({
    where: { ...publicProductWhere, id: { in: [...new Set(lines.map((line) => line.productId))] } },
    include: { variants: true, images: { orderBy: { position: "asc" } } },
  });
  return lines.map((line) => {
    const product = products.find((p) => p.id === line.productId);
    const variant = product?.variants.find((v) => v.id === line.variantId) ?? (product && !line.variantId && product.variants.length === 0 ? null : undefined);
    const image = (product?.images.find((i) => i.id === product.mainImageId) ?? product?.images[0])?.url;
    const stock = variant === null ? Math.max(0, product?.stock ?? 0) : Math.max(0, variant?.stock ?? 0);
    return {
      key: line.key ?? `${line.productId}:${line.variantId ?? "default"}`,
      productId: line.productId,
      variantId: variant?.id ?? null,
      categoryId: product?.categoryId ?? null,
      name: product?.name.trim() ?? "Article",
      size: variant?.size.trim() ?? "Unique",
      color: variant?.color.trim() ?? "",
      image: absoluteImage(variant?.image || image),
      unitPrice: product ? Number(product.price) : 0,
      stock,
      qty: line.qty,
      // Les articles en rupture restent commandables (collecte/reassort avant l'emballage,
      // comme sur le site) : seul un produit retire ou une taille supprimee est indisponible.
      available: Boolean(product) && variant !== undefined,
    };
  });
}

// ---------- Panier ----------

export async function validateCart(input: z.infer<typeof cartValidationSchema>) {
  const resolved = await resolveLines(input.lines);
  const lines = resolved.map((line, index) => {
    const clientPrice = input.lines[index].unitPrice;
    const message = !line.available
      ? "Cet article n'est plus disponible."
      : clientPrice !== undefined && clientPrice !== line.unitPrice
        ? "Le prix a change."
        : undefined;
    return { key: line.key, available: line.available, stock: line.stock, unitPrice: line.unitPrice, ...(message ? { message } : {}) };
  });
  return { ok: lines.every((line) => !("message" in line)), lines };
}

function toPromoCart(lines: ResolvedLine[]): CartItem[] {
  return lines.filter((line) => line.available).map((line) => ({ productId: line.productId, categoryId: line.categoryId ?? undefined, price: line.unitPrice, qty: line.qty }));
}

/** Code promo valide par le moteur du site (dates, quotas, minimum, produits/categories, usage par telephone). */
export async function validatePromo(input: z.infer<typeof promoValidationSchema>) {
  const lines = await resolveLines(input.lines);
  const phone = input.phone && isValidCiPhone(input.phone) ? normalizeCiPhone(input.phone) : undefined;
  const result = await validatePromoCode(input.code, toPromoCart(lines), phone);
  if (!result.success || !result.discount) throw new MobileApiError(result.error || "Code promo invalide.", 400, "PROMO_INVALID");
  const discount = result.discount;
  return {
    code: discount.code,
    label: discount.type === "GIFT" ? `${discount.label} (cadeau offert)` : discount.label || discount.code,
    discount: discount.amount,
    freeDelivery: false,
  };
}

// ---------- Creation idempotente ----------

const inFlight = new Map<string, Promise<CustomerOrder>>();

export function createMobileOrder(input: CreateOrderInput) {
  // Meme cle = meme commande, y compris pendant le traitement (double appui, reprise reseau).
  const pending = inFlight.get(input.idempotencyKey);
  if (pending) return pending;
  const job = createOnce(input).finally(() => inFlight.delete(input.idempotencyKey));
  inFlight.set(input.idempotencyKey, job);
  return job;
}

async function findByIdempotencyKey(key: string) {
  return prisma.order.findFirst({
    where: { deletedAt: null, history: { array_contains: [{ idempotencyKey: key }] } },
    include: { items: true },
  });
}

async function createOnce(input: CreateOrderInput): Promise<CustomerOrder> {
  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) return toCustomerOrder(existing);

  if (!isValidCiPhone(input.customer.phone)) throw new MobileApiError("Numero de telephone invalide.", 400, "INVALID_PHONE");
  const phone = normalizeCiPhone(input.customer.phone);
  const phone2 = input.customer.phone2 && isValidCiPhone(input.customer.phone2) ? normalizeCiPhone(input.customer.phone2) : undefined;

  // Livraison a domicile uniquement (le retrait en boutique n'est plus propose) ;
  // commune officielle et frais lus cote serveur.
  if (input.delivery.mode === "pickup") {
    throw new MobileApiError("Le retrait en boutique n'est plus disponible. Choisissez la livraison.", 400, "PICKUP_UNAVAILABLE");
  }
  const zone = await findZone(input.delivery.commune);
  if (!zone) throw new MobileApiError("Cette commune n'est pas desservie.", 400, "INVALID_COMMUNE");
  if (input.delivery.address.length < 3 || input.delivery.landmark.length < 3) {
    throw new MobileApiError("Indiquez votre quartier et un repere.", 400, "ADDRESS_REQUIRED");
  }
  const location = `${input.delivery.address} — Repere : ${input.delivery.landmark}`;

  // Articles : prix et disponibilite lus en base.
  const lines = await resolveLines(input.lines);
  // Rupture acceptee (article collecte avant l'emballage) ; produit retire refuse.
  const unavailable = lines.find((line) => !line.available);
  if (unavailable) throw new MobileApiError(`${unavailable.name} n'est plus disponible.`, 409, "UNAVAILABLE");

  // Remise : code saisi (valide par le moteur), sinon meilleure remise automatique, comme sur le site.
  const cart = toPromoCart(lines);
  let promoCode: string | undefined;
  let discount = 0;
  if (input.promoCode) {
    const result = await validatePromoCode(input.promoCode, cart, phone);
    if (!result.success || !result.discount) throw new MobileApiError(result.error || "Code promo invalide.", 400, "PROMO_INVALID");
    promoCode = result.discount.code;
    discount = result.discount.amount;
  } else {
    const automatic = await getBestAutomaticDiscount(cart, phone);
    if (automatic.code) {
      promoCode = automatic.code;
      discount = automatic.amount;
    }
  }

  const { order } = await createOrderWithContext(
    {
      customerName: input.customer.name,
      customerPhone: phone,
      customerPhone2: phone2,
      customerLocation: location,
      commune: zone.commune,
      deliveryFee: zone.fee,
      deliveryNote: input.notes || undefined,
      promoCode,
      discount,
      items: lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId ?? undefined,
        name: line.name,
        size: line.size,
        color: line.color,
        qty: line.qty,
        price: line.unitPrice,
        image: line.image ?? undefined,
      })),
      source: "public",
      status: "TO_PROCESS",
    },
    null,
  );

  // Marque la commande (origine + cle d'idempotence) pour les rejeux et le suivi interne.
  const created = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  const history = Array.isArray(created.history) ? [...(created.history as Record<string, unknown>[])] : [];
  history.push({ at: new Date().toISOString(), action: "Commande passee depuis l'application mobile", by: "app-mobile", byName: "Application mobile", idempotencyKey: input.idempotencyKey });
  const updated = await prisma.order.update({ where: { id: order.id }, data: { history: history as object[] }, include: { items: true } });
  return toCustomerOrder(updated);
}

// ---------- Vue client ----------

type OrderWithItems = NonNullable<Awaited<ReturnType<typeof findByIdempotencyKey>>>;

export type CustomerOrder = ReturnType<typeof toCustomerOrder>;

/** Vue client : jamais l'historique interne, le commercial ou le livreur. */
export function toCustomerOrder(order: OrderWithItems) {
  const subtotal = order.total;
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    commune: order.commune ?? "",
    address: order.customerLocation ?? "",
    customerName: order.customerName,
    phone: order.customerPhone,
    paymentMethod: "cod" as const,
    lines: order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      size: item.size,
      color: item.color,
      qty: item.qty,
      unitPrice: item.price,
      image: absoluteImage(item.image),
    })),
    subtotal,
    discount: order.discount,
    deliveryFee: order.deliveryFee,
    total: Math.max(0, subtotal - order.discount + order.deliveryFee),
    promoCode: order.promoCode,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
  };
}

/** Suivi : identifiant (ou reference) ET telephone doivent correspondre ; sinon introuvable. */
export async function trackOrder(idOrRef: string, phone: string) {
  const value = idOrRef.trim().replace(/^#/, "");
  // Numero court affiche au client (6 derniers caracteres de l'identifiant) tant qu'il n'y a pas de reference.
  const shortNumber = /^[a-z0-9]{6}$/i.test(value) ? value.toLowerCase() : null;
  const candidates = await prisma.order.findMany({
    where: { deletedAt: null, OR: [{ id: value }, { ref: value }, ...(shortNumber ? [{ id: { endsWith: shortNumber } }] : [])] },
    include: { items: true },
    take: 10,
  });
  const wanted = normalizeCiPhone(phone).slice(-10);
  const order = candidates.find((candidate) => normalizeCiPhone(candidate.customerPhone).slice(-10) === wanted);
  if (!order || wanted.length !== 10) throw new MobileApiError("Commande introuvable. Verifiez le numero et le telephone.", 404, "NOT_FOUND");
  return toCustomerOrder(order);
}
