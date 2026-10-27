import type { NextRequest } from "next/server";
import { z } from "zod";

import { getRiderHistory } from "@/app/zangochap-rider/history-actions";
import { handle, json, preflight } from "@/modules/mobile-api/http";
import { requireRider } from "@/modules/rider-app/api";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  from: day,
  to: day,
  status: z.string().max(30).default("all"),
  search: z.string().max(120).default(""),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

/** Historique sur une periode au choix (meme recherche que l'espace web), 30 par page. */
export function GET(request: NextRequest) {
  return handle(async () => {
    await requireRider();
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const input = schema.parse(params);
    const result = await getRiderHistory(input);
    return json({
      ...result,
      orders: result.orders.map((order) => ({
        id: order.id, ref: order.ref, customerName: order.customerName, customerPhone: order.customerPhone, customerPhone2: order.customerPhone2 ?? null,
        customerLocation: order.customerLocation ?? null, commune: order.commune ?? null, total: Number(order.total), deliveryFee: Number(order.deliveryFee),
        discount: Number(order.discount || 0), amountReceived: order.amountReceived ?? null, deliveredAt: order.deliveredAt ?? null,
        deliveryNote: order.deliveryNote ?? null, notes: order.notes ?? null, deliveryDate: order.deliveryDate ?? null, status: order.status,
        returnReason: order.returnReason ?? null, updatedAt: order.updatedAt, createdAt: order.createdAt, settlementId: order.settlementId ?? null,
        lastDeliveryAttemptAt: order.lastDeliveryAttemptAt ?? null, lastDeliveryAttemptRiderId: order.lastDeliveryAttemptRiderId ?? null,
        isCommercialContacted: order.isCommercialContacted ?? false,
        items: order.items.map((item) => ({ id: item.id, name: item.name, size: item.size, color: item.color, qty: item.qty, price: Number(item.price), image: item.image ?? null, isGift: item.isGift, isDelivered: item.isDelivered })),
        commercial: order.commercial ?? null,
      })),
    });
  });
}
