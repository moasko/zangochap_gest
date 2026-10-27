// Connexion de l'application livreur : comptes LIVREUR existants (e-mail ou telephone +
// mot de passe du back-office). Jeton porteur signe avec le secret staff, audience dediee.
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { z } from "zod";

import { getJwtSecret, RIDER_APP_AUDIENCE } from "@/lib/jwt-secret";
import prisma from "@/lib/prisma";
import { MobileApiError } from "@/modules/mobile-api/errors";

export const riderLoginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
});

function phoneVariants(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("225") && digits.length === 13 ? digits.slice(3) : digits;
  return [value.trim(), local, `225${local}`, `+225${local}`, `+225 ${local}`];
}

export async function loginRider(input: z.infer<typeof riderLoginSchema>) {
  const identifier = input.identifier.trim();
  const isEmail = identifier.includes("@");
  const user = await prisma.user.findFirst({
    where: isEmail ? { email: identifier.toLowerCase() } : { phone: { in: phoneVariants(identifier) } },
    select: { id: true, email: true, name: true, role: true, initials: true, phone: true, password: true },
  });
  // Meme reponse si le compte n'existe pas ou si le mot de passe est faux (pas d'enumeration).
  if (!user || !(await bcrypt.compare(input.password, user.password))) {
    throw new MobileApiError("Identifiant ou mot de passe incorrect.", 401, "INVALID_CREDENTIALS");
  }
  if (user.role !== "LIVREUR") throw new MobileApiError("Cette application est reservee aux livreurs.", 403, "NOT_A_RIDER");

  const initials = user.initials || user.name.split(" ").map((word) => word[0]).slice(0, 2).join("").toUpperCase();
  const token = await new SignJWT({ id: user.id, email: user.email, name: user.name, role: "livreur", initials })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(RIDER_APP_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getJwtSecret());
  return { token, rider: { id: user.id, name: user.name, email: user.email, phone: user.phone, initials } };
}
