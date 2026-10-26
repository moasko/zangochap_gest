// Utilitaires HTTP des routes /api/mobile/v1 : JSON, CORS, erreurs, limitation de debit.
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { MobileApiError } from "./errors";

// API publique sans cookie : CORS ouvert (application native, apercu web de developpement).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, init: { status?: number; cache?: number } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": init.cache ? `public, max-age=${init.cache}, stale-while-revalidate=${init.cache * 5}` : "no-store",
    },
  });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Execute le gestionnaire et convertit toute erreur en { error, code } avec le bon statut. */
export async function handle(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MobileApiError) return json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ZodError) return json({ error: "Donnees invalides.", code: "VALIDATION", details: error.issues.slice(0, 5) }, { status: 400 });
    if (error instanceof SyntaxError) return json({ error: "Requete invalide.", code: "BAD_JSON" }, { status: 400 });
    // Erreurs metier remontees par le service de commande (promo, point relais, doublon...).
    if (error instanceof Error && error.message && !/prisma|database|ECONN|timeout/i.test(error.message)) {
      console.error("[mobile-api]", error.message);
      return json({ error: error.message, code: "REJECTED" }, { status: 422 });
    }
    console.error("[mobile-api] erreur interne :", error);
    return json({ error: "Erreur serveur, reessayez dans un instant.", code: "INTERNAL" }, { status: 500 });
  }
}

// Limitation simple par IP (memoire du processus) pour les routes d'ecriture.
const hits = new Map<string, number[]>();

export function rateLimit(request: NextRequest, bucket: string, max: number, windowMs: number) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) throw new MobileApiError("Trop de tentatives. Patientez quelques minutes.", 429, "RATE_LIMITED");
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
}

export function intParam(value: string | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
