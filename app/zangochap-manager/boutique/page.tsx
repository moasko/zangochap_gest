import { redirect } from "next/navigation";
import { OrderStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import BoutiqueRelayClient, { type RelayOrder } from "./BoutiqueRelayClient";

const RELAY_MARKER = "[POINT_RELAIS]";

function getRelayMeta(deliveryNote?: string | null) {
  const relayLine = deliveryNote
    ?.split("\n")
    .find((line) => line.includes(RELAY_MARKER));

  if (!relayLine) {
    return { boutiqueName: "Boutique", shelfCode: null, relayNote: null };
  }

  const boutiqueName = relayLine.match(/Boutique:\s*([^|]+)/)?.[1]?.trim() || "Boutique";
  const shelfCode = relayLine.match(/Emplacement:\s*([^|]+)/)?.[1]?.trim() || null;
  const relayNote = relayLine.match(/Note:\s*(.+)$/)?.[1]?.trim() || null;
  return { boutiqueName, shelfCode, relayNote };
}

function getLastRelayAction(history: unknown) {
  if (!Array.isArray(history)) return null;
  const relayEvents = history
    .filter((entry): entry is { at?: string; action?: string; byName?: string } => {
      return Boolean(entry && typeof entry === "object" && "action" in entry && String((entry as { action?: unknown }).action || "").includes("Point relais"));
    })
    .reverse();

  return relayEvents[0] || null;
}

function getOrderHistory(history: unknown) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry): entry is { at?: string; action?: string; byName?: string } => (
      Boolean(entry && typeof entry === "object" && "action" in entry)
    ))
    .map((entry) => ({
      at: String(entry.at || ""),
      action: String(entry.action || "Mouvement de commande"),
      byName: entry.byName ? String(entry.byName) : null,
    }))
    .reverse()
    .slice(0, 24);
}

export default async function BoutiqueRelayPage() {
  const session = await getSession();
  if (!session) redirect("/zangochap-manager");

  const role = String(session.role || "").toLowerCase();
  if (!["admin", "developer", "collection", "point_relais"].includes(role)) {
    redirect("/zangochap-manager/dashboard");
  }

  const assignedRelay = String(session.serviceLabel || "").trim();

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      AND: [
        {
          OR: [
            { status: OrderStatus.COLLECTED },
            { deliveryNote: { contains: RELAY_MARKER, mode: "insensitive" } },
          ],
        },
        role === "point_relais"
          ? assignedRelay
            ? { deliveryNote: { contains: assignedRelay, mode: "insensitive" } }
            : { id: "__point_relais_non_attribue__" }
          : {},
      ],
    },
    orderBy: [
      { status: "asc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      ref: true,
      customerName: true,
      customerPhone: true,
      customerPhone2: true,
      customerLocation: true,
      commune: true,
      total: true,
      deliveryFee: true,
      status: true,
      deliveryNote: true,
      returnReason: true,
      amountReceived: true,
      deliveredAt: true,
      history: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          id: true,
          name: true,
          size: true,
          color: true,
          qty: true,
          price: true,
          image: true,
          isGift: true,
          product: {
            select: {
              images: {
                orderBy: { position: "asc" },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
      },
    },
    take: 160,
  });

  const visibleOrders = role === "point_relais"
    ? orders.filter((order) => getRelayMeta(order.deliveryNote).boutiqueName.toLowerCase() === assignedRelay.toLowerCase())
    : orders;

  const relayOrders: RelayOrder[] = visibleOrders.map((order) => {
    const meta = getRelayMeta(order.deliveryNote);
    const lastRelayAction = getLastRelayAction(order.history);
    return {
      id: order.id,
      ref: order.ref,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerPhone2: order.customerPhone2,
      customerLocation: order.customerLocation,
      commune: order.commune,
      total: order.total,
      deliveryFee: order.deliveryFee,
      status: order.status,
      boutiqueName: meta.boutiqueName,
      shelfCode: meta.shelfCode,
      relayNote: meta.relayNote,
      returnReason: order.returnReason,
      amountReceived: order.amountReceived,
      deliveredAt: order.deliveredAt,
      lastRelayAction: lastRelayAction?.action || null,
      lastRelayAt: lastRelayAction?.at || order.updatedAt.toISOString(),
      lastRelayBy: lastRelayAction?.byName || null,
      history: getOrderHistory(order.history),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size,
        color: item.color,
        qty: item.qty,
        price: item.price,
        image: item.image || item.product?.images[0]?.url || null,
        isGift: item.isGift,
      })),
    };
  });

  return (
    <BoutiqueRelayClient
      initialOrders={relayOrders}
      user={{
        name: String(session.name || "Equipe"),
        role,
        relayName: assignedRelay || null,
      }}
    />
  );
}
