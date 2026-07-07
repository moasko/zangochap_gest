"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

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

const JWT_SECRET = new TextEncoder().encode(resolveJwtSecret());

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
    .sign(JWT_SECRET);

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
    const { payload } = await jwtVerify(sessionToken, JWT_SECRET);

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
  const where: any = {};
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

  if (session.role === "admin" && data.role.toUpperCase() === "DEVELOPER") {
    throw new Error("Action non autorisée. Les administrateurs ne peuvent pas créer de compte développeur.");
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) return { success: false, error: "Email déjà utilisé" };

  const initials = data.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const hashedPassword = await bcrypt.hash(data.password, 10);

  await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      phone: data.phone,
      phone2: data.phone2,
      serviceLabel: data.serviceLabel,
      password: hashedPassword,
      role: data.role.toUpperCase() as any,
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

  if (session.role === "admin") {
    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { role: true }
    });
    if (targetUser?.role === "DEVELOPER") {
      throw new Error("Action non autorisée. Les administrateurs ne peuvent pas modifier de compte développeur.");
    }
    if (data.role?.toUpperCase() === "DEVELOPER") {
      throw new Error("Action non autorisée. Les administrateurs ne peuvent pas attribuer le rôle développeur.");
    }
  }

  const updateData: any = {};
  if (data.name) {
    updateData.name = data.name;
    updateData.initials = data.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  }
  if (data.email) updateData.email = data.email.toLowerCase();
  if (data.phone) updateData.phone = data.phone;
  if (data.phone2 !== undefined) updateData.phone2 = data.phone2;
  if (data.serviceLabel !== undefined) updateData.serviceLabel = data.serviceLabel;
  if (data.role) updateData.role = data.role.toUpperCase();
  if (data.password && data.password.length >= 4) {
    updateData.password = await bcrypt.hash(data.password, 10);
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
