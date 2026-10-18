import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

// Pas de notion de marque publique dans le catalogue (Supplier = fournisseur interne) : liste vide.
export function GET() {
  return handle(async () => json([], { cache: 600 }));
}
