import { handle, json, preflight } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET() {
  return handle(async () => {
    const rider = await requireRider();
    return json({ id: rider.id, name: rider.name, email: rider.email, initials: rider.initials });
  });
}
