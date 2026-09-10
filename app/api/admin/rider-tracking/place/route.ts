import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";
import { z } from "zod";

export const dynamic = "force-dynamic";
const input = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
const cache = new Map<string, { label: string | null; expires: number }>();
let nextRequestAt = 0;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user || !["ADMIN", "DEVELOPER"].includes(user.role.toUpperCase())) return json({ error: "Accès administrateur requis." }, 403);
  const lat = req.nextUrl.searchParams.get("lat");
  const lon = req.nextUrl.searchParams.get("lon");
  const parsed = input.safeParse({ latitude: lat?.trim() ? Number(lat) : NaN, longitude: lon?.trim() ? Number(lon) : NaN });
  if (!parsed.success) return json({ error: "Coordonnées invalides." }, 400);
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return json({ error: "Nom du lieu indisponible : service d’adresses non configuré." }, 503);
  const latitude = parsed.data.latitude.toFixed(4), longitude = parsed.data.longitude.toFixed(4);
  const key = latitude + "," + longitude;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return json({ label: cached.label });
  if (Date.now() < nextRequestAt) return json({ error: "Recherche occupée. Réessayez dans quelques secondes." }, 429);
  nextRequestAt = Date.now() + 1100;
  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.search = new URLSearchParams({ lat: latitude, lon: longitude, lang: "fr", format: "json", limit: "1", apiKey }).toString();
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return json({ error: "Service d’adresses temporairement indisponible." }, 503);
    const data: unknown = await response.json();
    const schema = z.object({ results: z.array(z.object({ formatted: z.string().optional() })) });
    const result = schema.safeParse(data);
    if (!result.success) return json({ error: "Adresse non reconnue." }, 503);
    const label = result.data.results[0]?.formatted?.trim().slice(0, 350) || null;
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { label, expires: Date.now() + (label ? 86400000 : 300000) });
    return json({ label });
  } catch { return json({ error: "Impossible de rechercher le lieu pour le moment." }, 503); }
}
