"use client";

// Demo locale de l'ecran Livraisons (donnees fictives, aucune base, aucune session).
// Les actions serveur sont simulees en memoire ; la repartition utilise le VRAI moteur
// (planDeliveryDispatch), donc le partage affiche est celui de la production.
import React, { useMemo, useRef, useState } from "react";
import type { OrderStatus } from "@prisma/client";
import AdminDeliveryClient from "@/app/zangochap-manager/admin/delivery/AdminDeliveryClient";
import type { DispatchActions } from "@/modules/orders/components/DeliveryDispatchModal";
import { DISPATCH_DEFAULT_CAPACITY, normalizeCommune, planDeliveryDispatch } from "@/modules/orders/helpers/delivery-dispatch";

type DemoOrder = {
  id: string; ref: string; customerName: string; customerPhone: string; customerLocation: string;
  commune: string; total: number; discount: number; deliveryFee: number; deliveryDate: string | null;
  deliverymanId: string | null; deliverymanName: string | null; status: string; type: string | null;
  settlementId: string | null; depositVerificationStatus: string | null; updatedAt: string; createdAt: string;
  items: { name: string; size: string; color: string; qty: number }[];
};

export const DEMO_RIDERS = [
  { id: "awa", name: "Awa", communes: ["Koumassi"], recent: 160 },
  { id: "koffi", name: "Koffi", communes: ["Koumassi", "Marcory"], recent: 150 },
  { id: "moussa", name: "Moussa", communes: ["Koumassi", "Port-Bouët"], recent: 140 },
  { id: "razack", name: "RAZACK", communes: ["Hors Abidjan"], recent: 200, capacity: 35 },
  { id: "fatou", name: "Fatou", communes: ["Cocody"], recent: 170 },
  { id: "ibrahim", name: "Ibrahim", communes: ["Yopougon"], recent: 165 },
  { id: "yao", name: "Yao", communes: ["Abobo"], recent: 120 },
  { id: "old1", name: "Ancien compte 1", communes: [], recent: 0 },
  { id: "old2", name: "Ancien compte 2", communes: [], recent: 0 },
];

function tomorrowKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildOrders(day: string): DemoOrder[] {
  const at = `${day}T00:00:00.000Z`;
  const orders: DemoOrder[] = [];
  let n = 0;
  const add = (commune: string, status: string, riderId: string | null, extra: Partial<DemoOrder> = {}) => {
    n += 1;
    const rider = DEMO_RIDERS.find((r) => r.id === riderId);
    orders.push({
      id: `demo-${n}`, ref: `ZC-${String(4100 + n)}`, customerName: `Client fictif ${n}`, customerPhone: "0100000000",
      customerLocation: n % 5 === 0 ? "" : `Quartier ${(n % 7) + 1}`, commune, total: 12000 + (n % 6) * 3500, discount: 0,
      deliveryFee: commune === "Hors Abidjan" ? 2500 : 1500, deliveryDate: at, deliverymanId: riderId,
      deliverymanName: rider ? rider.name : null, status, type: null, settlementId: null,
      depositVerificationStatus: commune === "Hors Abidjan" ? "RECEIVED" : null,
      updatedAt: "2026-10-06T10:00:00.000Z", createdAt: "2026-10-06T09:00:00.000Z",
      items: [{ name: "Article fictif", size: "M", color: "Noir", qty: 1 }], ...extra,
    });
  };
  for (let i = 0; i < 15; i++) add("Koumassi", "PACKED", null);
  for (let i = 0; i < 4; i++) add("Hors Abidjan", "PACKED", null);
  for (let i = 0; i < 6; i++) add("Cocody", "PACKED", i < 2 ? "fatou" : null);
  for (let i = 0; i < 5; i++) add("Yopougon", "PACKED", i < 3 ? "ibrahim" : null);
  for (let i = 0; i < 4; i++) add("Abobo", "ON_DELIVERY", "yao");
  for (let i = 0; i < 3; i++) add("Marcory", "ON_DELIVERY", "koffi");
  for (let i = 0; i < 3; i++) add("Plateau", "CONFIRMED", null);
  return orders;
}

export default function DeliveryDemo() {
  const day = useMemo(tomorrowKey, []);
  const [orders, setOrders] = useState<DemoOrder[]>(() => buildOrders(day));
  // Actions stables (la fenetre de repartition depend de leur identite) lisant l etat courant.
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const riders = DEMO_RIDERS.map(({ id, name }) => ({ id, name, phone: "0700000000" }));
  const deliverymen = DEMO_RIDERS.map(({ id, name, recent }) => ({ id, name, phone: "0700000000", recentCount: recent }));

  const setRider = (ids: string[], riderId: string | null) => {
    const rider = DEMO_RIDERS.find((r) => r.id === riderId) || null;
    setOrders((list) => list.map((o) => (ids.includes(o.id)
      ? {
        ...o,
        deliverymanId: rider?.id ?? null,
        deliverymanName: rider?.name ?? null,
        status: rider && o.status === "PACKED" ? "ON_DELIVERY" : o.status,
        updatedAt: new Date().toISOString(),
      }
      : o)));
  };

  const dispatch = useMemo<DispatchActions>(() => ({
    getPlan: async (options) => {
      const orders = ordersRef.current;
      const capacity = options.capacity || DISPATCH_DEFAULT_CAPACITY;
      const presentRiderIds = options.presentRiderIds ?? DEMO_RIDERS.filter((r) => r.recent > 0).map((r) => r.id);
      const candidates = orders.filter((o) => o.deliveryDate?.startsWith(options.date)
        && (!options.orderIds || options.orderIds.includes(o.id)) && !o.deliverymanId);
      const currentLoads: Record<string, number> = {};
      const currentCommunes: Record<string, string[]> = {};
      orders.filter((o) => o.deliverymanId && o.deliveryDate?.startsWith(options.date)).forEach((o) => {
        currentLoads[o.deliverymanId!] = (currentLoads[o.deliverymanId!] || 0) + 1;
        (currentCommunes[o.deliverymanId!] ||= []).push(o.commune);
      });
      const fixedCommunes = Object.fromEntries(DEMO_RIDERS.filter((r) => r.communes.length).map((r) => [r.id, r.communes]));
      const capacities = Object.fromEntries(DEMO_RIDERS.filter((r) => r.capacity).map((r) => [r.id, r.capacity!]));
      const plan = planDeliveryDispatch({
        orders: candidates, riders, presentRiderIds, capacity, currentLoads, currentCommunes,
        history: {}, fixedCommunes, capacities, includeUnpacked: options.includeUnpacked === true,
      });
      const byId = new Map(candidates.map((o) => [o.id, o]));
      const describe = (id: string) => {
        const o = byId.get(id)!;
        return {
          id: o.id, ref: o.ref, status: o.status as OrderStatus, commune: normalizeCommune(o.commune) || o.commune, customerName: o.customerName,
          amount: o.total + o.deliveryFee - o.discount, previousRiderName: null, missingAddress: !o.customerLocation, version: o.updatedAt,
        };
      };
      return {
        date: options.date,
        capacity,
        includeUnpacked: options.includeUnpacked === true,
        riders: DEMO_RIDERS.map((r) => ({
          id: r.id, name: r.name, present: presentRiderIds.includes(r.id), activeRecently: r.recent > 0, recentCount: r.recent,
          zones: r.communes.map((commune) => ({ commune, pct: Math.round(100 / Math.max(1, r.communes.length)) })),
          before: plan.loads[r.id]?.before ?? currentLoads[r.id] ?? 0, after: plan.loads[r.id]?.after ?? currentLoads[r.id] ?? 0,
          presenceReason: r.recent > 0 ? "Planning" : "Sans activite recente", fromPlanning: r.recent > 0,
          fixedCommunes: r.communes, capacity: r.capacity ?? null,
        })),
        assignments: plan.assignments.map((a) => ({ ...describe(a.orderId), riderId: a.riderId, reason: a.reason })),
        skipped: plan.skipped.map((s) => ({ ...describe(s.orderId), reason: s.reason })),
      };
    },
    applyPlan: async (input) => {
      const groups = new Map<string, string[]>();
      input.forEach((item) => groups.set(item.riderId, [...(groups.get(item.riderId) || []), item.orderId]));
      groups.forEach((ids, riderId) => setRider(ids, riderId));
      return { success: true, assignedCount: input.length, skipped: [] };
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps -- setRider ne lit que setOrders (stable)

  return (
    <AdminDeliveryClient
      activeOrders={orders}
      archivedOrders={[]}
      deliverymen={deliverymen}
      demoActions={{
        assign: async (orderId, riderId) => { setRider([orderId], riderId === "unassigned" ? null : riderId); return { success: true }; },
        bulkAssign: async (ids, riderId) => {
          setRider(ids, riderId === "unassigned" ? null : riderId);
          return { success: true, assignedCount: ids.length, skipped: [] };
        },
        dispatch,
      }}
    />
  );
}
