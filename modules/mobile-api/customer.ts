// Comptes clients de l'application mobile : memes comptes que le site (User role CUSTOMER,
// telephone + mot de passe bcrypt). Session par jeton porteur signe, distinct des sessions staff.
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";

import { MobileApiError } from "./errors";
import { isValidCiPhone, normalizeCiPhone, toCustomerOrder } from "./orders";

const LEAKED_DEFAULT_SECRET = "zangochap-super-secret-key-change-me-in-prod";
const AUDIENCE = "zangochap-mobile-customer";
const TOKEN_TTL = "180d";

let cachedKey: Uint8Array | null = null;

/**
 * Cle derivee de JWT_SECRET (jamais la cle staff elle-meme) : un jeton client ne peut
 * pas etre presente comme session du back-office, et inversement.
 */
function signingKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === LEAKED_DEFAULT_SECRET) {
    if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET manquant.");
    console.warn("[mobile-api] JWT_SECRET absent : cle de developpement utilisee.");
  }
  cachedKey = createHash("sha256").update(`mobile-customer:${secret || "dev-only-insecure"}`).digest();
  return cachedKey;
}

// Le site enregistre le numero tel que saisi : on cherche les ecritures courantes.
function phoneVariants(phone: string) {
  const local = normalizeCiPhone(phone);
  return [local, `225${local}`, `+225${local}`, `+225 ${local}`];
}

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom.").max(80),
  phone: z.string().trim().min(8).max(20),
  password: z.string().min(6, "Mot de passe : 6 caracteres minimum.").max(100),
  email: z.string().trim().email("E-mail invalide.").max(120).optional().or(z.literal("")),
});

export const loginSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  password: z.string().min(1).max(100),
});

type CustomerUser = { id: string; name: string; phone: string | null; email: string };

function toProfile(user: CustomerUser) {
  return {
    id: user.id,
    name: user.name,
    phone: normalizeCiPhone(user.phone ?? ""),
    // Adresse technique generee pour les comptes sans e-mail : jamais renvoyee.
    email: user.email.endsWith("@clients.zangochap.invalid") ? null : user.email,
  };
}

async function issueToken(user: CustomerUser) {
  const token = await new SignJWT({ typ: "customer" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(signingKey());
  return { token, customer: toProfile(user) };
}

export async function registerCustomer(input: z.infer<typeof registerSchema>) {
  if (!isValidCiPhone(input.phone)) throw new MobileApiError("Numero de telephone invalide.", 400, "INVALID_PHONE");
  const phone = normalizeCiPhone(input.phone);
  const existing = await prisma.user.findFirst({ where: { phone: { in: phoneVariants(phone) } }, select: { id: true } });
  if (existing) throw new MobileApiError("Un compte existe deja avec ce numero. Connectez-vous.", 409, "ACCOUNT_EXISTS");

  const email = input.email ? input.email.toLowerCase() : `${phone}@clients.zangochap.invalid`;
  if (input.email && (await prisma.user.findUnique({ where: { email }, select: { id: true } }))) {
    throw new MobileApiError("Cet e-mail est deja utilise.", 409, "EMAIL_EXISTS");
  }
  const user = await prisma.user.create({
    data: { name: input.name, phone, email, password: await bcrypt.hash(input.password, 10), role: "CUSTOMER" },
    select: { id: true, name: true, phone: true, email: true },
  });
  return issueToken(user);
}

export async function loginCustomer(input: z.infer<typeof loginSchema>) {
  const user = await prisma.user.findFirst({
    where: { phone: { in: phoneVariants(input.phone) }, role: "CUSTOMER" },
    select: { id: true, name: true, phone: true, email: true, password: true },
  });
  // Meme message que le compte existe ou non (pas d'enumeration des numeros).
  if (!user || !(await bcrypt.compare(input.password, user.password))) {
    throw new MobileApiError("Numero ou mot de passe incorrect.", 401, "INVALID_CREDENTIALS");
  }
  return issueToken(user);
}

/** Client authentifie par l'en-tete Authorization: Bearer <jeton>. */
export async function requireCustomer(request: NextRequest): Promise<CustomerUser> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new MobileApiError("Connectez-vous pour continuer.", 401, "UNAUTHENTICATED");
  let subject: string | undefined;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { audience: AUDIENCE });
    subject = payload.sub;
  } catch {
    throw new MobileApiError("Session expiree. Reconnectez-vous.", 401, "UNAUTHENTICATED");
  }
  const user = subject
    ? await prisma.user.findFirst({ where: { id: subject, role: "CUSTOMER" }, select: { id: true, name: true, phone: true, email: true } })
    : null;
  if (!user) throw new MobileApiError("Compte introuvable.", 401, "UNAUTHENTICATED");
  return user;
}

export function customerProfile(user: CustomerUser) {
  return toProfile(user);
}

/** Commandes passees avec le numero du compte (site, application ou telephone). */
export async function customerOrders(user: CustomerUser) {
  if (!user.phone) return [];
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, customerPhone: { in: phoneVariants(user.phone) } },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return orders.map(toCustomerOrder);
}
