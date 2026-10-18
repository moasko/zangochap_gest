import { getRelayPoints } from "@/modules/mobile-api/delivery";
import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET() {
  return handle(async () => json(await getRelayPoints(), { cache: 300 }));
}
