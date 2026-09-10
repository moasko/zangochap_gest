"use client";

import React from "react";
import { Banknote, CheckCircle2, Clock3, PackageCheck, ReceiptText, Wallet } from "lucide-react";
import { motion } from "framer-motion";
import { formatPrice } from "@/lib/constants";
import { RiderOrder, RiderRevenueDay, RiderStats } from "../types";
import { calculateOrderCollectionTotal } from "../utils";

type WalletViewProps = {
  stats: RiderStats;
  ordersToSettle: RiderOrder[];
  revenueHistory: RiderRevenueDay[];
};

function formatTime(value: string | Date) {
  return new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function WalletView({ stats, ordersToSettle, revenueHistory }: WalletViewProps) {
  const latestPending = ordersToSettle.slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 py-2 pb-10"
    >
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-[20px] font-black text-[#111827]">Mes revenus</h2>
          <p className="text-[11px] font-bold text-[#64748B]">Point cash et versements</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-[#BBF7D0] bg-[#F0FDF4] px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-[#166534]">
          <span className="h-1.5 w-1.5 rounded-sm bg-[#166534]" />
          Vue personnelle
        </span>
      </div>

      <section className="relative overflow-hidden rounded-md bg-[#111827] p-5 text-white shadow-sm">
        <div className="absolute -right-7 -top-7 text-white/5">
          <Wallet size={118} strokeWidth={1.2} />
        </div>
        <div className="relative">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
            À verser à la caisse
          </p>
          <h3 className="mb-5 text-[34px] font-black leading-none tracking-tight tabular-nums">
            {formatPrice(stats.amountToSettle)}
          </h3>

          <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
            <RevenueMiniStat icon={<Banknote size={14} />} label="Cash du jour" value={formatPrice(stats.todayCash)} />
            <RevenueMiniStat icon={<PackageCheck size={14} />} label="Colis livrés" value={`${stats.deliveredToday}`} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <MetricCard
          icon={<CheckCircle2 size={16} />}
          label="Livrés aujourd'hui"
          value={`${stats.deliveredToday}`}
          helper={stats.partiallyDeliveredToday > 0 ? `${stats.partiallyDeliveredToday} partiel(s)` : "Complets et partiels"}
        />
        <MetricCard
          icon={<Clock3 size={16} />}
          label="En attente"
          value={`${ordersToSettle.length}`}
          helper={formatPrice(stats.amountToSettle)}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9CA3AF]">
            À verser
          </h4>
          <span className="text-[10px] font-black text-[#64748B]">{ordersToSettle.length} colis</span>
        </div>

        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          {latestPending.length === 0 ? (
            <div className="p-7 text-center">
              <p className="text-[12px] font-black text-[#111827]">Aucun versement en attente</p>
              <p className="mt-1 text-[10px] font-semibold text-[#94A3B8]">Tous les encaissements visibles sont déjà pointés.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F1F5F9]">
              {latestPending.map((order) => (
                <RevenueOrderRow key={order.id} order={order} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9CA3AF]">
            Historique revenus
          </h4>
          <span className="text-[10px] font-black text-[#64748B]">{revenueHistory.length} jour(s)</span>
        </div>

        <div className="space-y-2">
          {revenueHistory.length === 0 ? (
            <div className="rounded-md border border-[#E5E7EB] bg-white p-7 text-center shadow-sm">
              <ReceiptText size={22} className="mx-auto mb-2 text-[#CBD5E1]" />
              <p className="text-[12px] font-black text-[#111827]">Aucun revenu livré</p>
              <p className="mt-1 text-[10px] font-semibold text-[#94A3B8]">Les livraisons clôturées apparaîtront ici.</p>
            </div>
          ) : (
            revenueHistory.slice(0, 12).map((day) => (
              <article key={day.key} className="rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-black capitalize text-[#111827]">{day.label}</p>
                    <p className="text-[10px] font-bold text-[#64748B]">
                      {day.delivered + day.partial} colis livré(s) · {day.partial} partiel(s)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] font-black tabular-nums text-[#111827]">{formatPrice(day.total)}</p>
                    <p className="text-[9px] font-black uppercase text-[#64748B]">encaissé</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <HistoryAmount label="Déjà versé" value={day.settled} tone="green" />
                  <HistoryAmount label="Reste à verser" value={day.pending} tone={day.pending > 0 ? "orange" : "slate"} />
                </div>

                <div className="mt-3 divide-y divide-[#F1F5F9] border-t border-[#F1F5F9] pt-1">
                  {day.orders.slice(0, 4).map((order) => (
                    <RevenueOrderRow key={order.id} order={order} compact />
                  ))}
                  {day.orders.length > 4 && (
                    <p className="px-1 pt-2 text-[10px] font-bold text-[#94A3B8]">
                      +{day.orders.length - 4} autre(s) colis
                    </p>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </motion.div>
  );
}

function RevenueMiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-sm border border-white/10 bg-white/5 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-white/55">
        {icon}
        <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[14px] font-black tabular-nums text-white">{value}</p>
    </div>
  );
}

function MetricCard({ icon, label, value, helper }: { icon: React.ReactNode; label: string; value: string; helper: string }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3 shadow-sm">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-sm bg-[#F8FAFC] text-[#334155]">
        {icon}
      </div>
      <p className="text-[10px] font-black uppercase tracking-wider text-[#94A3B8]">{label}</p>
      <p className="mt-1 text-[22px] font-black leading-none text-[#111827]">{value}</p>
      <p className="mt-1 text-[10px] font-bold text-[#64748B]">{helper}</p>
    </div>
  );
}

function HistoryAmount({ label, value, tone }: { label: string; value: number; tone: "green" | "orange" | "slate" }) {
  const toneClass = {
    green: "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]",
    orange: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]",
    slate: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]",
  }[tone];

  return (
    <div className={`rounded-sm border px-2.5 py-2 ${toneClass}`}>
      <p className="text-[9px] font-black uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-[12px] font-black tabular-nums">{formatPrice(value)}</p>
    </div>
  );
}

function RevenueOrderRow({ order, compact = false }: { order: RiderOrder; compact?: boolean }) {
  const amount = calculateOrderCollectionTotal(order);
  const dateValue = order.updatedAt || order.deliveryDate || order.createdAt;

  return (
    <div className={`flex items-center justify-between gap-3 ${compact ? "px-1 py-2" : "p-3"}`}>
      <div className="min-w-0">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-[12px] font-black text-[#111827]">#{order.ref}</span>
          <span className="max-w-[130px] truncate text-[10px] font-bold text-[#64748B]">{order.customerName}</span>
        </div>
        <p className="text-[10px] font-bold uppercase text-[#94A3B8]">
          {formatTime(dateValue)} · {order.settlementId ? "Versé" : "À verser"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-black tabular-nums text-[#111827]">{formatPrice(amount)}</p>
        <span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-black uppercase ${
          order.settlementId ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]"
        }`}>
          {order.settlementId ? "Pointé" : "Cash"}
        </span>
      </div>
    </div>
  );
}
