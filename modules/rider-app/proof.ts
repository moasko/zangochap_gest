// Preuve de livraison (photo du colis remis, signature du client). Donnees personnelles :
// images reduites et stockees en base (CmsContent, pas de migration), JAMAIS en URL publique ;
// consultables par l'equipe via /api/admin/delivery-proof/[key]. Reference dans l'historique.
import sharp from "sharp";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { MobileApiError } from "@/modules/mobile-api/errors";

const PROOF_PREFIX = "delivery-proof:";

// Data URL JPEG/PNG/WebP (photo) ou SVG (signature dessinee), ~1,5 Mo maximum une fois encodee.
const imageData = z.string().max(2_000_000).regex(/^data:image\/(jpeg|png|webp|svg\+xml);base64,/, "Image invalide.");

export const proofSchema = z
  .object({
    photo: imageData.optional(),
    signature: imageData.optional(),
    recipientName: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.photo || value.signature, "Ajoutez une photo ou une signature.");

async function compress(dataUrl: string, maxSide: number) {
  const buffer = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  // Signature SVG : rendue en image par sharp (aucun script ni ressource externe autorises).
  if (dataUrl.startsWith("data:image/svg+xml") && /<script|<foreignObject|href\s*=\s*["']?(?!#)/i.test(buffer.toString("utf8"))) {
    throw new MobileApiError("Signature invalide.", 400, "INVALID_SIGNATURE");
  }
  const jpeg = await sharp(buffer).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 72 }).toBuffer();
  return jpeg.toString("base64");
}

export async function addDeliveryProof(rider: { id: string; email: string; name: string }, orderId: string, input: z.infer<typeof proofSchema>) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, deliverymanId: true, history: true, deletedAt: true } });
  if (!order || order.deletedAt) throw new MobileApiError("Commande introuvable.", 404, "NOT_FOUND");
  if (order.deliverymanId !== rider.id) throw new MobileApiError("Cette commande ne vous est pas attribuee.", 403, "FORBIDDEN");

  const key = `${PROOF_PREFIX}${order.id}:${Date.now()}`;
  const [photo, signature] = await Promise.all([input.photo ? compress(input.photo, 1000) : null, input.signature ? compress(input.signature, 600) : null]);
  const at = new Date().toISOString();
  await prisma.cmsContent.create({
    data: { key, updatedBy: rider.email, data: { orderId: order.id, riderId: rider.id, at, photo, signature, recipientName: input.recipientName || null, note: input.note || null } },
  });

  const history = Array.isArray(order.history) ? [...(order.history as Record<string, unknown>[])] : [];
  history.push({
    at,
    action: `Preuve de livraison${photo ? " (photo)" : ""}${signature ? " (signature)" : ""}${input.recipientName ? ` - remis a ${input.recipientName}` : ""}`,
    by: rider.email,
    byName: rider.name,
    deliveryProofKey: key,
  });
  await prisma.order.update({ where: { id: order.id }, data: { history: history as object[] } });
  return { key, at, hasPhoto: Boolean(photo), hasSignature: Boolean(signature) };
}

/** Lecture reservee a l'equipe (verification du role faite par la route). */
export async function readDeliveryProof(key: string) {
  if (!key.startsWith(PROOF_PREFIX)) return null;
  const row = await prisma.cmsContent.findUnique({ where: { key } });
  return (row?.data as { orderId: string; photo: string | null; signature: string | null; recipientName: string | null; note: string | null; at: string } | undefined) ?? null;
}
