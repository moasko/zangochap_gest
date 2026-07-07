"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/constants";
import { Product } from "@/lib/types";
import { useCart } from "@/lib/CartContext";
import { ShoppingBag, Check } from "lucide-react";
import { getImageUrl } from "@/lib/utils";
import PublicVariantModal from "./PublicVariantModal";
import { useRouter } from "next/navigation";

export default function ProductCard({ p }: { p: Product }) {
  const { addToCart } = useCart();
  const router = useRouter();
  const [added, setAdded] = useState(false);
  const [modalType, setModalType] = useState<"cart" | "buy" | null>(null);

  const discount = p.oldPrice ? Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100) : 0;
  // Produit sans choix a faire (une seule variante) : on evite le modal et on
  // agit directement, exactement comme un vrai "ajout rapide".
  const soleVariant = p.variants?.length === 1 ? p.variants[0] : null;

  const doAddToCart = (variant: any, qty: number) => {
    addToCart({
      productId: p.id,
      variantId: variant.id,
      name: p.name,
      price: Number(p.price),
      qty,
      size: variant.size,
      color: variant.color,
      image: getImageUrl(variant.image || p.images?.[0]?.url),
    });
    setModalType(null);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const handleBuyNow = (variant: any, qty: number) => {
    sessionStorage.setItem("zangochap_buy_now", JSON.stringify({
      productId: p.id,
      variantId: variant.id,
      name: p.name,
      price: Number(p.price),
      qty,
      size: variant.size,
      color: variant.color,
      image: getImageUrl(variant.image || p.images?.[0]?.url),
    }));
    setModalType(null);
    router.push("/cart?buyNow=1");
  };

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (soleVariant) doAddToCart(soleVariant, 1);
    else setModalType("cart");
  };

  const handleBuyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (soleVariant) handleBuyNow(soleVariant, 1);
    else setModalType("buy");
  };

  return (
    <article className="group block relative no-underline text-inherit">
      <Link href={`/product/${p.slug || p.id}`} className="block relative aspect-[3.5/4.5] bg-[#F7F6F3] overflow-hidden mb-4 rounded-sm">
        {p.images?.[0] ? (
          <img
            src={getImageUrl(p.images[0].url)}
            alt={p.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl font-extralight text-[#D5D0C8]">Z</div>
        )}

        {discount > 0 && (
          <div className="absolute top-3 left-3 bg-[#D4541C] text-white px-2 py-1 text-[10px] font-extrabold rounded-sm">
            -{discount}%
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-white/90 text-[#1A1614] py-3 text-center text-[10px] font-extrabold tracking-widest translate-y-full transition-transform duration-300 group-hover:translate-y-0">
          VOIR LES DÉTAILS
        </div>
      </Link>

      <div className="px-1">
        <span className="text-[9px] font-bold text-[#D4541C] uppercase tracking-widest mb-1.5 block">
          {p.category?.name || 'Mode'}
        </span>
        <h3 className="text-sm font-normal text-[#333] mb-1.5 whitespace-nowrap overflow-hidden text-overflow-ellipsis">
          {p.name}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#1A1614]">{formatPrice(Number(p.price))}</span>
          {p.oldPrice && (
            <span className="text-xs text-[#AAA] line-through">{formatPrice(Number(p.oldPrice))}</span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={handleQuickAdd}
            disabled={!p.variants?.length}
            className={`min-h-10 border px-2 text-[10px] font-bold tracking-[0.1em] transition-colors ${added ? "border-[#2D8A4E] bg-[#2D8A4E] text-white" : "border-[#1A1614] bg-white text-[#1A1614] hover:bg-[#1A1614] hover:text-white"
              }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {added ? <Check size={13} /> : <ShoppingBag size={13} />} Ajouter au panier
            </span>
          </button>
          <button
            onClick={handleBuyClick}
            disabled={!p.variants?.length}
            className="min-h-10 bg-[#D4541C] px-2 text-[10px] font-bold tracking-[0.1em] text-white transition-colors hover:bg-[#B33D0E]"
          >
            Acheter
          </button>
        </div>
      </div>
      <PublicVariantModal
        product={modalType ? p : null}
        onClose={() => setModalType(null)}
        onConfirm={modalType === "buy" ? handleBuyNow : doAddToCart}
        title={modalType === "buy" ? "Acheter ce produit" : "Choisir la variante"}
        actionLabel={modalType === "buy" ? "Acheter" : "Valider le panier"}
      />
    </article>
  );
}
