import { getPublicCategories } from "@/modules/mobile-api/catalog";
import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET() {
  return handle(async () => json(await getPublicCategories(), { cache: 120 }));
}
