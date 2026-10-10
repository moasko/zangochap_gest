"use client";

import { Bike, CheckCircle2, Loader2, MapPin, Phone } from "lucide-react";
import { StatusBadge } from "@/components/UI";
import type { OrderWithItems, PreviewItemData } from "./types";

interface OrderCardProps {
  order: OrderWithItems;
  verifyingOrderId: string | null;
  verifyingItemIds: Set<string>;
  onToggleItem: (itemId: string, currentStatus: boolean) => void;
  onToggleAll: (order: OrderWithItems, targetStatus: boolean) => void;
  onPreview: (data: PreviewItemData) => void;
}

export default function OrderCard({
  order,
  verifyingOrderId,
  verifyingItemIds,
  onToggleItem,
  onToggleAll,
  onPreview,
}: OrderCardProps) {
  const orderItems = order.items || [];
  const totalQty = orderItems.reduce((sum, item) => sum + (item.qty || 0), 0);
  const checkedCount = orderItems.reduce((sum, item) => sum + (item.isVerified ? item.qty || 0 : 0), 0);
  const isAllChecked = orderItems.every(item => item.isVerified) && orderItems.length > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden print:overflow-visible print:border-gray-300 print:break-inside-avoid animate-fade-in">
      {/* HEADER */}
      <div className="bg-[#FCFBF9] p-3 md:px-4 md:py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2 print:bg-gray-50 print:p-2.5">
        <div className="flex flex-wrap items-center gap-2.5 md:gap-3">
          <span className="font-mono text-xs font-bold bg-gray-200/70 text-gray-800 px-2 py-0.5 rounded border border-gray-300 print:bg-gray-200">
            {order.ref}
          </span>
          <div className="text-sm font-extrabold text-gray-900 flex items-center gap-2 flex-wrap">
            {order.customerName}
            <span className="text-xs font-semibold text-gray-500 flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-gray-200 print:border-none print:bg-transparent print:p-0">
              <Phone size={11} className="text-gray-400" /> {order.customerPhone}
            </span>
          </div>
          {order.commune && (
            <div className="text-xs font-bold text-gray-600 flex items-center gap-1 bg-orange-50 text-orange-800 px-2 py-0.5 rounded border border-orange-100 print:border-none print:bg-transparent print:p-0">
              <MapPin size={12} className="text-orange-500" /> {order.commune}
            </div>
          )}
          <div
            className={`text-xs font-bold flex items-center gap-1 px-2 py-0.5 rounded border print:border-none print:bg-transparent print:p-0 ${
              order.deliverymanName
                ? "bg-blue-50 text-blue-800 border-blue-100"
                : "bg-gray-50 text-gray-500 border-gray-200"
            }`}
            title="Livreur a qui la commande est attribuee"
          >
            <Bike size={12} className={order.deliverymanName ? "text-blue-500" : "text-gray-400"} />
            {order.deliverymanName || "Non attribuée"}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 md:gap-3">
          <StatusBadge status={order.status} />
          <div className={`text-xs font-bold ${isAllChecked ? "text-emerald-600" : "text-gray-500"}`}>
            {checkedCount} / {totalQty} vérifié(s)
          </div>
          <button
            className="flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 hover:border-emerald-50 hover:bg-emerald-50 text-gray-700 hover:text-emerald-600 rounded text-xs font-bold transition-all cursor-pointer print:hidden"
            onClick={() => onToggleAll(order, !isAllChecked)}
            disabled={verifyingOrderId === order.id}
          >
            {verifyingOrderId === order.id ? (
              <Loader2 size={13} className="animate-spin" />
            ) : isAllChecked ? (
              "Dé-vérifier tout ✕"
            ) : (
              "Tout vérifier ✓"
            )}
          </button>
        </div>
      </div>

      {/* ITEMS TABLE */}
      <div className="w-full overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-left print:w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-bold text-gray-500 print:bg-gray-100">
              <th className="w-10 py-2 px-3 text-center">✓</th>
              <th className="py-2 px-3">Article</th>
              <th className="w-16 py-2 px-3 text-center">Qté</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orderItems.map(item => {
              const isChecked = !!item.isVerified;
              const isVerifying = verifyingItemIds.has(item.id);
              const rawImageUrl = item.image || item.product?.images?.[0]?.url || "";
              const imageUrl = rawImageUrl.includes(";") ? rawImageUrl.split(";")[0] : rawImageUrl || undefined;

              return (
                <tr
                  key={item.id}
                  className={`transition-colors ${isChecked ? "bg-amber-50/60 print:bg-transparent" : "hover:bg-gray-50/50"}`}
                >
                  <td className="py-2.5 px-3 text-center align-middle">
                    <button
                      className={`w-6 h-6 rounded border flex items-center justify-center transition-all cursor-pointer print:w-4 print:h-4 print:rounded-xs print:border ${
                        isVerifying
                          ? "bg-orange-50 border-orange-500 text-orange-500"
                          : isChecked
                          ? "bg-emerald-500 border-emerald-500 text-white print:bg-transparent print:border-black print:text-black"
                          : "bg-white border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 text-emerald-500 print:border-gray-400"
                      }`}
                      onClick={() => onToggleItem(item.id, isChecked)}
                      disabled={isVerifying}
                    >
                      {isVerifying ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        isChecked && <CheckCircle2 size={15} className="print:w-3.5 print:h-3.5" />
                      )}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 align-middle">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (imageUrl)
                            onPreview({
                              url: imageUrl,
                              name: item.name,
                              size: item.size || undefined,
                              color: item.color || undefined,
                            });
                        }}
                        className={`w-9 h-9 bg-gray-100 rounded flex items-center justify-center overflow-hidden border border-gray-200 flex-shrink-0 ${
                          imageUrl ? "cursor-zoom-in hover:opacity-80 transition-opacity" : ""
                        }`}
                      >
                        {imageUrl ? (
                          <img src={imageUrl} alt={item.name} className="w-full h-full object-cover pointer-events-none" />
                        ) : (
                          <span className="text-lg pointer-events-none">{item.emoji || "📦"}</span>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-gray-900 truncate">{item.name}</div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {item.size && (
                            <span className="bg-gray-100 text-gray-700 font-extrabold text-[11px] px-1.5 py-0.5 rounded border border-gray-200">
                              {item.size}
                            </span>
                          )}
                          {item.color && (
                            <span className="text-[11px] font-bold text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                              {item.color}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center align-middle">
                    <div className="text-base font-black text-orange-500 print:text-black">{item.qty}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
