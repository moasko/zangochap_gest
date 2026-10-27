import { handle, json, preflight } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";
import { loadRiderOrders } from "@/modules/rider-app/orders";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/** Missions actives, historique 60 j et encaissements non regles (meme jeu que l'espace web). */
export function GET() {
  return handle(async () => {
    const rider = await requireRider();
    return json({ serverTime: new Date().toISOString(), orders: await loadRiderOrders(rider) });
  });
}
