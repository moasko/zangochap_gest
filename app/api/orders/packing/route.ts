import { NextResponse } from "next/server";
import { assertPackingAccess, getPackingOrders, getPackingProducts } from "@/modules/logistics/packing/data";
import { getSession } from "@/modules/auth/actions";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    assertPackingAccess(user);

    const orders = await getPackingOrders();
    const products = await getPackingProducts(orders);

    return NextResponse.json(JSON.parse(JSON.stringify({ orders, products })));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de charger les commandes";
    const status = message.includes("réservé") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
