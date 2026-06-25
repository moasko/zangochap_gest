"use client";

import React from "react";
import { AlertTriangle, CalendarClock, MapPin, Package, ChevronRight, Banknote, Clock, StickyNote } from "lucide-react";
import { motion } from "framer-motion";
import { formatPrice } from "@/lib/constants";
import { StatusBadge } from "./StatusBadge";
import { RiderOrder } from "../types";
import { calculateOrderCollectionTotal } from "../utils";

interface OrderCardProps {
  order: RiderOrder;
  onClick: () => void;
  index?: number;
}

export function OrderCard({ order, onClick, index = 0 }: OrderCardProps) {
  const total = calculateOrderCollectionTotal(order);
  const totalQty = order.items?.reduce((sum, i) => sum + i.qty, 0) ?? 0;
  const time = new Date(order.updatedAt || order.createdAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const deliveryDate = order.deliveryDate
    ? new Date(order.deliveryDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
    : "Jour J";
  const hasIssue = ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status);
  const cardNote = order.deliveryNote || order.notes;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <button
        onClick={onClick}
        className="w-full bg-white rounded-sm border border-[#E5E7EB] p-3 text-left active:scale-[0.98] transition-all duration-150 group"
      >
        <div className="flex flex-col gap-3">
          {/* Top Row: Ref & Price */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-[#F3F4F6] px-2 py-0.5 rounded-sm">
                <span className="text-[14px] font-extrabold text-[#111827] tabular-nums">#{order.ref}</span>
              </div>
              <div className="flex items-center gap-1 text-[#6B7280]">
                <Clock size={12} />
                <span className="text-[10px] font-medium">{time}</span>
              </div>
              <div className="flex items-center gap-1 text-[#6B7280]">
                <CalendarClock size={12} />
                <span className="text-[10px] font-medium">{deliveryDate}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-[#334155]/5 px-2 py-1 rounded-sm border border-[#334155]/10">
              <Banknote size={12} className="text-[#334155]" />
              <span className="text-[13px] font-extrabold text-[#334155] tabular-nums">
                {formatPrice(total)}
              </span>
            </div>
          </div>

          {/* Middle Row: Location (priorité livreur) & Customer */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[#334155]">
              <MapPin size={15} className="text-[#334155] shrink-0" />
              <span className="text-[16px] font-extrabold truncate">{order.commune || "Commune non renseignée"}</span>
            </div>
            <p className="pl-[21px] text-[14px] font-bold leading-snug text-[#475569] line-clamp-2">
              {order.customerLocation || "Lieu exact non renseigné"}
            </p>
            <h3 className="text-[12px] font-medium text-[#6B7280] leading-tight">
              {order.customerName}
            </h3>
            {cardNote && (
              <div className="flex items-start gap-1.5 rounded-sm bg-[#F8FAFC] px-2 py-1.5 text-[#475569] border border-[#E2E8F0]">
                <StickyNote size={12} className="shrink-0 mt-0.5" />
                <span className="text-[11px] font-semibold leading-snug line-clamp-2">
                  {cardNote}
                </span>
              </div>
            )}
            {hasIssue && (
              <div className="flex items-start gap-1.5 rounded-sm bg-[#FFFBEB] px-2 py-1.5 text-[#92400E] border border-[#FDE68A]">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span className="text-[11px] font-bold leading-snug line-clamp-2">
                  {order.returnReason || "Motif non renseigné"}
                </span>
              </div>
            )}
          </div>

          {/* Bottom Row: Status & Items */}
          <div className="flex items-center justify-between pt-1 border-t border-[#F3F4F6]">
            <StatusBadge status={order.status} />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[#9CA3AF]">
                <Package size={12} />
                <span className="text-[11px] font-semibold">{totalQty} art.</span>
              </div>
              <ChevronRight size={16} className="text-[#9CA3AF] group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}
