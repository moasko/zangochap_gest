"use client";

import React, { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { Product, ProductVariant } from "@/lib/types";
import { formatPrice } from "@/lib/constants";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { getImageUrl } from "@/lib/utils";
import { useVariantSelection } from "@/lib/useVariantSelection";

type PublicVariantModalProps = {
  product: Product | null;
  onClose: () => void;
  onConfirm: (variant: ProductVariant, qty: number) => void;
  actionLabel?: string;
  title?: string;
};

export default function PublicVariantModal({
  product,
  onClose,
  onConfirm,
  actionLabel,
  title,
}: PublicVariantModalProps) {
  const {
    sizes,
    colors,
    selectedSize,
    selectedColor,
    selectSize,
    selectColor,
    isSizeEnabled,
    isColorEnabled,
    currentVariant: selectedVariant,
    hasSingleSize,
    hasSingleColor,
  } = useVariantSelection(product?.variants);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (product) setQty(1);
  }, [product]);

  const previewImage = selectedVariant?.image || product?.images?.[0]?.url;

  if (!product) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title || "Choisir la variante"}
      footer={
        <button
          className="h-11 w-full bg-[#1A1614] px-5 text-[12px] font-semibold tracking-[0.14em] text-white disabled:opacity-40"
          disabled={!selectedVariant}
          onClick={() => selectedVariant && onConfirm(selectedVariant, qty)}
        >
          <span className="inline-flex items-center gap-2">
            <ShoppingBag size={16} /> {actionLabel || "Valider le panier"}
          </span>
        </button>
      }
    >
      <div className="grid gap-6 text-[#1A1614]">
        <div className="flex gap-4">
          <div className="h-[92px] w-[74px] flex-shrink-0 overflow-hidden bg-[#F5F3EF]">
            {previewImage ? (
              <img src={getImageUrl(previewImage)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl text-[#D5D0C8]">Z</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D4541C]">
              {actionLabel || "Ajouter au panier"}
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-tight">{product.name}</h2>
            <div className="mt-2 text-sm font-semibold">{formatPrice(Number(product.price))}</div>
          </div>
        </div>

        {/* On masque une dimension entierement quand elle n'offre aucun choix
            (taille ou couleur unique) : elle est deja auto-selectionnee. */}
        {!hasSingleSize && (
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777]">
              <span>Taille</span>
              {selectedSize && <span className="text-[#1A1614]">{selectedSize}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {sizes.map((size) => {
                const enabled = isSizeEnabled(size);
                return (
                  <button
                    key={size}
                    disabled={!enabled}
                    className={`min-h-10 min-w-12 border px-3 text-xs font-semibold transition-colors ${
                      selectedSize === size
                        ? "border-[#1A1614] bg-[#1A1614] text-white"
                        : "border-[#E6E1D9] bg-white text-[#1A1614] hover:enabled:border-[#1A1614]"
                    } ${!enabled ? "cursor-not-allowed opacity-40 line-through" : "cursor-pointer"}`}
                    onClick={() => selectSize(size)}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!hasSingleColor && (
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777]">
              <span>Couleur</span>
              {selectedColor && <span className="text-[#1A1614]">{selectedColor}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {colors.map((color) => {
                const enabled = isColorEnabled(color);
                return (
                  <button
                    key={color}
                    disabled={!enabled}
                    className={`min-h-10 border px-3 text-xs font-semibold transition-colors ${
                      selectedColor === color
                        ? "border-[#D4541C] bg-[#D4541C] text-white"
                        : "border-[#E6E1D9] bg-white text-[#1A1614] hover:enabled:border-[#D4541C]"
                    } ${!enabled ? "cursor-not-allowed opacity-40 line-through" : "cursor-pointer"}`}
                    onClick={() => selectColor(color)}
                  >
                    {color}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[#EEE8DF] pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777]">Quantite</span>
          <div className="flex h-11 items-center border border-[#E6E1D9]">
            <button className="flex h-full w-11 items-center justify-center" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Moins">
              <Minus size={15} />
            </button>
            <span className="flex h-full w-10 items-center justify-center border-x border-[#E6E1D9] font-semibold">{qty}</span>
            <button className="flex h-full w-11 items-center justify-center" onClick={() => setQty(qty + 1)} aria-label="Plus">
              <Plus size={15} />
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
