"use client";

import React from "react";
import { Calendar, ChevronRight, Package, CheckCircle2 } from "lucide-react";
import { formatPrice } from "@/lib/constants";
import { RiderOrder } from "../types";
import { calculateOrderCollectionTotal } from "../utils";

interface HistoryGroupCardProps {
  date: string;
  orders: RiderOrder[];
  onClick: () => void;
}

export function HistoryGroupCard({ date, orders, onClick }: HistoryGroupCardProps) {
  const stats = {
    total: orders
      .filter((o) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(o.status))
      .reduce((acc, o) => acc + calculateOrderCollectionTotal(o), 0),
    delivered: orders.filter(o => o.status === "DELIVERED").length,
    pending: orders.filter(o => !["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"].includes(o.status)).length,
    count: orders.length
  };

  const isToday = date === new Date().toDateString();
  const isYesterday = date === new Date(Date.now() - 86400000).toDateString();
  const label = isToday ? "Aujourd'hui" : isYesterday ? "Hier" : new Date(date).toLocaleDateString("fr-FR", { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-md border border-[#F3F4F6] p-4 text-left active:scale-[0.98] transition-all shadow-sm flex items-center gap-4"
    >
      <div className="w-12 h-12 rounded-md bg-[#F3F4F6] flex flex-col items-center justify-center text-[#111827]">
        <Calendar size={18} className="mb-0.5 opacity-50" />
        <span className="text-[10px] font-black uppercase">{new Date(date).getDate()}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[15px] font-black text-[#111827] capitalize">{label}</h3>
          <span className="text-[14px] font-black text-[#334155] tabular-nums">
            {formatPrice(stats.total)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Package size={12} className="text-[#9CA3AF]" />
            <span className="text-[11px] font-bold text-[#9CA3AF]">
              {stats.count} courses
            </span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle2 size={12} className="text-[#166534]" />
            <span className="text-[11px] font-bold text-[#166534]">
              {stats.delivered} livrés
            </span>
          </div>
          {stats.pending > 0 && (
            <div className="flex items-center gap-1 bg-[#FEF2F2] px-1.5 py-0.5 rounded-sm border border-[#FECACA]">
              <span className="w-1.5 h-1.5 rounded-sm bg-[#B91C1C]" />
              <span className="text-[10px] font-black text-[#B91C1C] uppercase">
                {stats.pending} à faire
              </span>
            </div>
          )}
        </div>
      </div>

      <ChevronRight size={18} className="text-[#9CA3AF]" />
    </button>
  );
}
