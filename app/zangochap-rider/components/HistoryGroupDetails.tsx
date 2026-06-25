"use client";

import React from "react";
import { X, Banknote } from "lucide-react";
import { motion } from "framer-motion";
import { formatPrice } from "@/lib/constants";
import { RiderOrder } from "../types";
import { OrderCard } from "./OrderCard";
import { calculateOrderCollectionTotal } from "../utils";

interface HistoryGroupDetailsProps {
  date: string;
  orders: RiderOrder[];
  onClose: () => void;
  onOpenOrder: (order: RiderOrder) => void;
}

export function HistoryGroupDetails({ date, orders, onClose, onOpenOrder }: HistoryGroupDetailsProps) {
  const stats = {
    total: orders
      .filter((o) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(o.status))
      .reduce((acc, o) => acc + calculateOrderCollectionTotal(o), 0),
    delivered: orders.filter(o => o.status === "DELIVERED").length,
    returned: orders.filter(o => o.status === "RETURNED" || o.status === "CANCELLED").length,
    partial: orders.filter(o => o.status === "PARTIALLY_DELIVERED").length,
    count: orders.length
  };

  const label = new Date(date).toLocaleDateString("fr-FR", { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long',
    year: 'numeric'
  });

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-[200] bg-[#F3F4F6] flex flex-col"
    >
      {/* Header */}
      <header className="shrink-0 px-4 pt-6 pb-4 bg-white border-b border-[#E5E7EB]">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-md bg-[#F3F4F6] text-[#111827] active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>
          <div>
            <h2 className="text-[16px] font-black text-[#111827] leading-none mb-1">
              Détails de Session
            </h2>
            <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider">
              {label}
            </p>
          </div>
        </div>
      </header>

      {/* Stats Summary */}
      <div className="p-4 space-y-4 overflow-y-auto pb-10">
        <div className="bg-[#111827] rounded-md p-5 shadow-sm relative overflow-hidden">
          <div className="absolute -right-6 -top-6 text-white/5 rotate-12">
            <Banknote size={100} strokeWidth={1} />
          </div>
          <div className="relative z-10">
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em] mb-1 block">
              Recettes Totales
            </span>
            <p className="text-[28px] font-black text-white tabular-nums mb-4">
              {formatPrice(stats.total)}
            </p>
            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/10">
              <div className="text-center">
                <p className="text-[14px] font-black text-[#166534]">{stats.delivered}</p>
                <p className="text-[8px] font-bold text-white/40 uppercase tracking-wider">Livrés</p>
              </div>
              <div className="text-center">
                <p className="text-[14px] font-black text-[#B45309]">{stats.partial}</p>
                <p className="text-[8px] font-bold text-white/40 uppercase tracking-wider">Partiels</p>
              </div>
              <div className="text-center">
                <p className="text-[14px] font-black text-[#B91C1C]">{stats.returned}</p>
                <p className="text-[8px] font-bold text-white/40 uppercase tracking-wider">Retours</p>
              </div>
            </div>
          </div>
        </div>

        {/* Orders List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-black text-[#111827] uppercase tracking-wider">
              Liste des courses ({stats.count})
            </span>
          </div>
          <div className="space-y-2">
            {orders.map((order, idx) => (
              <OrderCard 
                key={order.id} 
                order={order} 
                index={idx} 
                onClick={() => onOpenOrder(order)} 
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
