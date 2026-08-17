"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";

const accountSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(30).optional(),
  phone2: z.string().trim().max(30).optional(),
  serviceLabel: z.string().trim().max(100).optional(),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(Role),
});

const accountUpdateSchema = accountSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  "Aucune modification fournie.",
);

// Le secret de signature ne doit JAMAIS retomber sur une valeur connue : l'ancien
// fallback etait present dans le repo, donc n'importe qui pouvait forger un cookie
// de session admin. On accepte tout secret defini par l'exploitant (sa longueur est
// son choix) ; on refuse seulement l'absence de secret ou l'ancienne valeur fuitee.
const LEAKED_DEFAULT_SECRET = "zangochap-super-secret-key-change-me-in-prod";

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret !== LEAKED_DEFAULT_SECRET) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET manquant ou egal a l'ancienne valeur par defaut compromise. Definissez un secret unique avant de demarrer en production.",
    );
  }
  console.warn("[auth] JWT_SECRET absent : secret de developpement ephemere utilise. Ne pas utiliser en production.");
  return "dev-only-insecure-secret-do-not-use-in-production";
}

// Resolution paresseuse : `next build` importe ce module (NODE_ENV=production)
// sans disposer des secrets d'exploitation. La verification ne doit donc
// s'executer qu'au premier usage reel (login / lecture de session), pas a l'import.
let cachedJwtSecret: Uint8Array | null = null;

function getJwtSecret() {
  if (!cachedJwtSecret) {
    cachedJwtSecret = new TextEncoder().encode(resolveJwtSecret());
  }
  return cachedJwtSecret;
}

export async function loginAction(formData: FormData) {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    return { success: false, error: "Email et mot de passe requis." };
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return { success: false, error: "Identifiants incorrects." };
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return { success: false, error: "Identifiants incorrects." };
  }

  const sessionData = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.toLowerCase(),
    initials: user.initials || user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(),
  };

  const sessionToken = await new SignJWT(sessionData)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());

  (await cookies()).set("zc_session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  if (user.role.toUpperCase() === 'LIVREUR') {
    redirect("/zangochap-rider");
  } else if (user.role.toUpperCase() === 'POINT_RELAIS') {
    redirect("/zangochap-manager/boutique");
  } else if (user.role.toUpperCase() === 'COMPTABLE') {
    redirect("/zangochap-manager/accounting");
  } else {
    redirect("/zangochap-manager/dashboard");
  }
}

export async function logoutAction() {
  (await cookies()).delete("zc_session");
  redirect("/zangochap-manager");
}

export async function getSession() {
  try {
    const sessionToken = (await cookies()).get("zc_session")?.value;
    if (!sessionToken) return null;
    const { payload } = await jwtVerify(sessionToken, getJwtSecret());

    const sessionId = typeof payload.id === "string" ? payload.id : "";
    const sessionEmail = typeof payload.email === "string"
      ? payload.email.trim().toLowerCase()
      : "";

    if (!sessionId && !sessionEmail) return null;

    // JWTs can outlive a database refresh. Resolve the current database user
    // so stale IDs never reach foreign-key fields in business actions.
    const userSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      initials: true,
      serviceLabel: true,
    } as const;

    let user = sessionId
      ? await prisma.user.findUnique({ where: { id: sessionId }, select: userSelect })
      : null;

    if (!user || (sessionEmail && user.email.toLowerCase() !== sessionEmail)) {
      user = sessionEmail
        ? await prisma.user.findUnique({ where: { email: sessionEmail }, select: userSelect })
        : null;
    }

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.toLowerCase(),
      initials: user.initials || user.name
        .split(" ")
        .map((word) => word[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
      serviceLabel: user.serviceLabel,
    };
  } catch {
    return null;
  }
}

async function ensureAdmin() {
  const session = await getSession();
  if (!session || (session.role !== "admin" && session.role !== "developer")) {
    throw new Error("Action non autorisée. Droits administrateur requis.");
  }
  return session;
}

// ============ ACCOUNT MANAGEMENT ============
export async function getAccounts() {
  const session = await ensureAdmin();
  const where: Prisma.UserWhereInput = {};
  if (session.role === "admin") {
    where.role = { not: "DEVELOPER" };
  }

  return prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      phone2: true,
      serviceLabel: true,
      initials: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function createAccount(data: {
  name: string;
  email: string;
  phone?: string;
  phone2?: string;
  serviceLabel?: string;
  password: string;
  role: string;
}) {
  const session = await ensureAdmin();

  const parsed = accountSchema.safeParse({ ...data, role: data.role.toUpperCase() });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Données de compte invalides." };
  }
  const account = parsed.data;

  if (session.role === "admin" && account.role === Role.DEVELOPER) {
    throw new Error("Action non autorisée. Les administrateurs ne peuvent pas créer de compte développeur.");
  }

  const existing = await prisma.user.findUnique({ where: { email: account.email } });
  if (existing) return { success: false, error: "Email déjà utilisé" };

  const initials = account.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const hashedPassword = await bcrypt.hash(account.password, 10);

  await prisma.user.create({
    data: {
      email: account.email,
      name: account.name,
      phone: account.phone,
      phone2: account.phone2,
      serviceLabel: account.serviceLabel,
      password: hashedPassword,
      role: account.role,
      initials,
    },
  });

  revalidatePath("/zangochap-manager/admin/team");
  revalidatePath("/zangochap-manager/directory");
  return { success: true };
}

export async function updateAccount(email: string, data: {
  name?: string;
  email?: string;
  phone?: string;
  phone2?: string;
  serviceLabel?: string;
  role?: string;
  password?: string;
}) {
  const session = await ensureAdmin();

  const parsed = accountUpdateSchema.safeParse({
    ...data,
    email: data.email?.trim().toLowerCase(),
    role: data.role?.toUpperCase(),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Données de compte invalides." };
  }
  const account = parsed.data;

  if (session.role === "admin") {
    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { role: true }
    });
    if (targetUser?.role === "DEVELOPER") {
      throw new Error("Action non autorisée. Les administrateurs ne peuvent pas modifier de compte développeur.");
    }
    if (account.role === Role.DEVELOPER) {
      throw new Error("Action non autorisée. Les administrateurs ne peuvent pas attribuer le rôle développeur.");
    }
  }

  const updateData: Prisma.UserUpdateInput = {};
  if (account.name) {
    updateData.name = account.name;
    updateData.initials = account.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  }
  if (account.email) updateData.email = account.email;
  if (account.phone) updateData.phone = account.phone;
  if (account.phone2 !== undefined) updateData.phone2 = account.phone2;
  if (account.serviceLabel !== undefined) updateData.serviceLabel = account.serviceLabel;
  if (account.role) updateData.role = account.role;
  if (account.password) {
    updateData.password = await bcrypt.hash(account.password, 10);
  }

  await prisma.user.update({
    where: { email },
    data: updateData,
  });

  revalidatePath("/zangochap-manager/admin/team");
  revalidatePath("/zangochap-manager/directory");
  return { success: true };
}

export async function deleteAccount(email: string) {
  const session = await ensureAdmin();

  if (session.role === "admin") {
    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { role: true }
    });
    if (targetUser?.role === "DEVELOPER") {
      throw new Error("Action non autorisée. Les administrateurs ne peuvent pas supprimer de compte développeur.");
    }
  }

  await prisma.user.delete({ where: { email } });
  revalidatePath("/zangochap-manager/admin/team");
  return { success: true };
}
