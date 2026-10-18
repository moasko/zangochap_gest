import { handle, json, preflight } from "@/modules/mobile-api/http";
import { getMobileHome } from "@/modules/mobile-api/home";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET() {
  return handle(async () => json(await getMobileHome(), { cache: 60 }));
}
