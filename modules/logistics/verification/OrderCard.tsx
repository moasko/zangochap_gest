"use client";

import { Bike, Check, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/UI";
import type { OrderItemWithProduct, OrderWithItems, PreviewItemData } from "./types";

interface OrderCardProps {
  order: OrderWithItems;
  verifyingOrderId: string | null;
  verifyingItemIds: Set<string>;
  onToggleItem: (itemId: string, currentStatus: boolean) => void;
  onToggleAll: (order: OrderWithItems, targetStatus: boolean) => void;
  onPreview: (data: PreviewItemData) => void;
}

function itemImageUrl(item: OrderItemWithProduct) {
  const raw = item.image || item.product?.images?.[0]?.url || "";
  return raw.includes(";") ? raw.split(";")[0] : raw || undefined;
}

function ItemThumb({ item, size, onPreview }: { item: OrderItemWithProduct; size: string; onPreview: (data: PreviewItemData) => void }) {
  const imageUrl = itemImageUrl(item);
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        if (imageUrl) onPreview({ url: imageUrl, name: item.name, size: item.size || undefined, color: item.color || undefined });
      }}
      className={`${size} bg-gray-100 rounded-md flex items-center justify-center overflow-hidden border border-gray-200 flex-shrink-0 ${
        imageUrl ? "cursor-zoom-in hover:opacity-80 transition-opacity" : "cursor-default"
      }`}
      aria-label={imageUrl ? `Agrandir la photo de ${item.name}` : undefined}
      tabIndex={imageUrl ? 0 : -1}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- images produits externes de tailles variees
        <img src={imageUrl} alt={item.name} className="w-full h-full object-cover pointer-events-none" />
      ) : (
        <span className="text-lg pointer-events-none">{item.emoji || "📦"}</span>
      )}
    </button>
  );
}

function ItemVariants({ item }: { item: OrderItemWithProduct }) {
  if (!item.size && !item.color) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {item.size && (
        <span className="bg-gray-100 text-gray-700 font-extrabold text-[11px] px-1.5 py-0.5 rounded border border-gray-200">{item.size}</span>
      )}
      {item.color && (
        <span className="text-[11px] font-bold text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">{item.color}</span>
      )}
    </div>
  );
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
  const isTogglingAll = verifyingOrderId === order.id;
  const progress = totalQty > 0 ? (checkedCount / totalQty) * 100 : 0;

  return (
    <div
      className={`bg-white border rounded-xl md:rounded-md overflow-hidden print:overflow-visible print:border-gray-300 print:break-inside-avoid animate-fade-in transition-colors ${
        isAllChecked ? "border-emerald-300" : "border-gray-200"
      }`}
    >
      {/* HEADER : reference et etat, puis commune et livreur, puis progression et action */}
      <div className="bg-[#FCFBF9] p-3 md:px-4 md:py-3 border-b border-gray-200 flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-4 print:bg-gray-50 print:p-2.5">
        <div className="flex flex-col gap-2 min-w-0 md:flex-row md:items-center md:gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm md:text-xs font-bold bg-gray-200/70 text-gray-800 px-2 py-0.5 rounded border border-gray-300 print:bg-gray-200">
              {order.ref}
            </span>
            <span className="md:hidden print:hidden">
              <StatusBadge status={order.status} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            {order.commune && (
              <span className="text-xs font-bold flex items-center gap-1 bg-orange-50 text-orange-800 px-2 py-1 md:py-0.5 rounded border border-orange-100 print:border-none print:bg-transparent print:p-0">
                <MapPin size={12} className="text-orange-500" /> {order.commune}
              </span>
            )}
            <span
              className={`text-xs font-bold flex items-center gap-1 px-2 py-1 md:py-0.5 rounded border print:border-none print:bg-transparent print:p-0 ${
                order.deliverymanName ? "bg-blue-50 text-blue-800 border-blue-100" : "bg-gray-50 text-gray-500 border-gray-200"
              }`}
              title="Livreur a qui la commande est attribuee"
            >
              <Bike size={12} className={order.deliverymanName ? "text-blue-500" : "text-gray-400"} />
              {order.deliverymanName || "Non attribuée"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 md:flex-shrink-0">
          <span className="hidden md:inline-flex print:inline-flex">
            <StatusBadge status={order.status} />
          </span>
          <div className="flex-1 md:flex-none md:w-28 min-w-0">
            <div className={`text-xs font-bold ${isAllChecked ? "text-emerald-600" : "text-gray-500"}`}>
              {checkedCount} / {totalQty} vérifié(s)
            </div>
            <div className="mt-1 h-1 bg-gray-200 rounded overflow-hidden print:hidden">
              <div
                className={`h-full transition-all duration-300 ${isAllChecked ? "bg-emerald-500" : "bg-orange-500"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <button
            className={`flex items-center justify-center gap-1.5 h-10 px-4 md:h-8 md:px-3 rounded-lg md:rounded-md border text-sm md:text-xs font-bold transition-all cursor-pointer whitespace-nowrap print:hidden ${
              isAllChecked
                ? "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                : "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600"
            }`}
            onClick={() => onToggleAll(order, !isAllChecked)}
            disabled={isTogglingAll}
          >
            {isTogglingAll ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isAllChecked ? (
              "Dé-vérifier tout ✕"
            ) : (
              "Tout vérifier ✓"
            )}
          </button>
        </div>
      </div>

      {/* ITEMS — MOBILE : ligne entiere tactile */}
      <ul className="divide-y divide-gray-100 md:hidden print:hidden">
        {orderItems.map(item => {
          const isChecked = !!item.isVerified;
          const isVerifying = verifyingItemIds.has(item.id);
          return (
            <li key={item.id}>
              <div
                role="checkbox"
                aria-checked={isChecked}
                aria-disabled={isVerifying}
                tabIndex={0}
                onClick={() => !isVerifying && onToggleItem(item.id, isChecked)}
                onKeyDown={e => {
                  if ((e.key === " " || e.key === "Enter") && !isVerifying) {
                    e.preventDefault();
                    onToggleItem(item.id, isChecked);
                  }
                }}
                className={`flex items-center gap-3 px-3 py-2.5 min-h-[64px] cursor-pointer select-none transition-colors active:bg-gray-100 ${
                  isChecked ? "bg-emerald-50/70" : "bg-white"
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    isVerifying
                      ? "border-orange-400 text-orange-500 bg-orange-50"
                      : isChecked
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {isVerifying ? <Loader2 size={15} className="animate-spin" /> : isChecked && <Check size={17} strokeWidth={3} />}
                </span>
                <ItemThumb item={item} size="w-12 h-12" onPreview={onPreview} />
                <div className="min-w-0 flex-1">
                  <div className={`font-bold text-[13px] leading-snug line-clamp-2 ${isChecked ? "text-gray-500" : "text-gray-900"}`}>
                    {item.name}
                  </div>
                  <ItemVariants item={item} />
                </div>
                <span className={`text-lg font-black flex-shrink-0 ${isChecked ? "text-emerald-600" : "text-orange-500"}`}>
                  ×{item.qty}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* ITEMS — ORDINATEUR ET IMPRESSION */}
      <div className="hidden md:block print:block w-full overflow-x-auto print:overflow-visible">
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
                      aria-label={`${isChecked ? "Annuler la vérification de" : "Vérifier"} ${item.name}`}
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
                      <ItemThumb item={item} size="w-9 h-9" onPreview={onPreview} />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-gray-900 truncate">{item.name}</div>
                        <ItemVariants item={item} />
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
