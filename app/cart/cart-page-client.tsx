"use client";

import React, { useState, useTransition, useEffect } from "react";
import { CartItem, useCart } from "@/lib/CartContext";
import { formatPrice } from "@/lib/constants";
import { Trash2, ShoppingBag, ArrowRight, CheckCircle2, ShieldCheck, ChevronLeft, Tag } from "lucide-react";
import Link from "next/link";
import { createPublicOrder } from "@/modules/orders/actions";
import { getAutomaticDiscountAction, validatePromoCodeAction } from "@/modules/products/actions";
import { useToast } from "@/components/Toast";
import { useSearchParams } from "next/navigation";
import { Commune } from "@/lib/types";

export default function CartPageClient({ communes = [], relayPoints = [] }: { communes?: Commune[]; relayPoints?: string[] }) {
  const { cart, removeFromCart, clearCart } = useCart();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [directItem, setDirectItem] = useState<CartItem | null>(null);
  const isBuyNow = searchParams.get("buyNow") === "1";

  // Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [commune, setCommune] = useState("");
  const [address, setAddress] = useState("");

  // Promo State
  const [discount, setDiscount] = useState<{ code: string | null, amount: number, label: string | null, type?: string | null, giftProductId?: string | null }>({
    code: null,
    amount: 0,
    label: null,
    type: null,
    giftProductId: null
  });
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [showPromoInput, setShowPromoInput] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);

  // Fetch automatic or manual discount
  useEffect(() => {
    const checkoutItems = directItem ? [directItem] : cart;
    if (checkoutItems.length > 0) {
      const fetchDiscount = async () => {
        if (appliedPromo) {
          const res = await validatePromoCodeAction(
            appliedPromo,
            checkoutItems.map(item => ({
              productId: item.productId,
              price: item.price,
              qty: item.qty
            })),
            phone || undefined
          );
          if (res.success && res.discount) {
            setDiscount(res.discount);
            setPromoError(null);
          } else {
            setDiscount({ code: null, amount: 0, label: null, type: null, giftProductId: null });
            setAppliedPromo(null);
            showToast(res.error || "Le code promo n'est plus applicable.", "error");
          }
        } else {
          const res = await getAutomaticDiscountAction(
            checkoutItems.map(item => ({
              productId: item.productId,
              price: item.price,
              qty: item.qty
            })),
            phone || undefined
          );
          setDiscount(res);
        }
      };
      fetchDiscount();
    } else {
      setDiscount({ code: null, amount: 0, label: null, type: null, giftProductId: null });
      setAppliedPromo(null);
    }
  }, [cart, directItem, phone, appliedPromo]);

  const handleApplyPromo = async () => {
    if (!promoInput.trim()) return;
    setIsValidatingPromo(true);
    setPromoError(null);

    try {
      const checkoutItems = directItem ? [directItem] : cart;
      const res = await validatePromoCodeAction(
        promoInput.trim(),
        checkoutItems.map(item => ({
          productId: item.productId,
          price: item.price,
          qty: item.qty
        })),
        phone || undefined
      );

      if (res.success && res.discount) {
        setAppliedPromo(res.discount.code);
        setDiscount(res.discount);
        showToast("Code promo appliqué avec succès !", "success");
        setPromoInput("");
        setPromoError(null);
      } else {
        setPromoError(res.error || "Code promo invalide.");
        showToast(res.error || "Code promo invalide.", "error");
      }
    } catch (err) {
      console.error(err);
      setPromoError("Une erreur est survenue lors de la validation.");
    } finally {
      setIsValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    setDiscount({ code: null, amount: 0, label: null, type: null, giftProductId: null });
    showToast("Code promo retiré.", "success");
  };

  useEffect(() => {
    if (!isBuyNow) {
      setDirectItem(null);
      return;
    }

    const saved = sessionStorage.getItem("zangochap_buy_now");
    if (!saved) return;
    try {
      setDirectItem(JSON.parse(saved));
    } catch {
      sessionStorage.removeItem("zangochap_buy_now");
    }
  }, [isBuyNow]);



  const selectedCommuneObj = communes.find(c => c.name === commune);
  const deliveryFee = selectedCommuneObj ? selectedCommuneObj.deliveryFee : 0;
  const checkoutItems = directItem ? [directItem] : cart;
  const checkoutTotal = checkoutItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const grandTotal = Math.max(0, checkoutTotal + deliveryFee - discount.amount);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (checkoutItems.length === 0) return;
    if (!name || !phone || !commune || !address) {
      showToast("Veuillez remplir tous les champs de livraison", "error");
      return;
    }

    startTransition(async () => {
      try {
        const res = await createPublicOrder({
          customerName: name,
          customerPhone: phone,
          customerPhone2: phone2 || undefined,
          customerLocation: address,
          commune,
          deliveryFee,
          promoCode: discount.code || undefined,
          discount: discount.amount,
          items: checkoutItems.map(item => ({
            productId: item.productId,
            variantId: item.variantId,
            name: item.name,
            size: item.size,
            color: item.color,
            qty: item.qty,
            price: item.price,
            image: item.image,
          }))
        });

        if (!res.success) {
          // Le vrai motif remonte du serveur (rupture, promo expiree, point relais...).
          showToast(res.error, "error");
          return;
        }

        showToast("Commande validée avec succès !", "success");
        if (directItem) {
          sessionStorage.removeItem("zangochap_buy_now");
        } else {
          clearCart();
        }
        setOrderSuccess(true);
      } catch {
        showToast("Erreur reseau. Verifiez votre connexion et reessayez.", "error");
      }
    });
  };

  if (orderSuccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-6 py-[60px]">
        <div className="text-center max-w-[460px] animate-[fadeUp_0.5s_ease]">
          <div className="mb-7"><CheckCircle2 size={56} color="#2D8A4E" strokeWidth={1.5} /></div>
          <h1 className="text-[22px] font-light tracking-[0.2em] mb-4 text-[#1A1614]">COMMANDE CONFIRMÉE</h1>
          <p className="text-sm text-[#888] leading-relaxed mb-9">Merci pour votre confiance. Notre équipe vous contactera dans les prochaines minutes pour organiser la livraison.</p>
          <Link href="/" className="inline-block px-12 py-4 bg-[#1A1614] text-white no-underline text-[11px] font-semibold tracking-[0.15em] transition-all hover:bg-[#333] hover:-translate-y-0.5">CONTINUER MES ACHATS</Link>
        </div>
      </div>
    );
  }

  if (checkoutItems.length === 0) {
    // L'achat direct s'appuie sur sessionStorage : en navigation privee ou apres
    // un vidage, l'article peut etre perdu. On l'explique au lieu de laisser croire
    // a un panier vide inexplicable.
    const buyNowLost = isBuyNow;
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 py-20 text-center animate-[fadeUp_0.5s_ease]">
        <ShoppingBag size={56} color="#ddd" strokeWidth={1.2} />
        <h1 className="text-xl font-light tracking-[0.2em] mt-6 mb-3 text-[#1A1614]">
          {buyNowLost ? "ARTICLE INDISPONIBLE" : "VOTRE PANIER EST VIDE"}
        </h1>
        <p className="text-sm text-[#999] mb-8">
          {buyNowLost
            ? "Nous n'avons pas pu retrouver l'article. Retournez sur la boutique et cliquez a nouveau sur Acheter."
            : "Parcourez notre collection et trouvez la pièce parfaite."}
        </p>
        <Link href="/" className="inline-block px-12 py-4 bg-[#1A1614] text-white no-underline text-[11px] font-semibold tracking-[0.15em] transition-all hover:bg-[#333]">DÉCOUVRIR LA BOUTIQUE</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-6 pb-20 animate-[fadeUp_0.4s_ease] font-body w-full">
      <div className="mb-5">
        <Link href="/" className="no-underline text-[#999] text-[12px] inline-flex items-center gap-1 font-medium tracking-wider transition-colors hover:text-[#1A1614]">
          <ChevronLeft size={14} /> Continuer mes achats
        </Link>
      </div>
      <h1 className="text-2xl font-light tracking-[0.2em] text-[#1A1614] mb-10 uppercase">
        {directItem ? "ACHAT DIRECT" : "PANIER"} <span className="text-[#bbb]">({checkoutItems.length})</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-[60px] items-start">
        {/* ═══ ITEMS ═══ */}
        <div className="flex flex-col gap-0">
          {checkoutItems.map((item: any) => (
            <div key={item.variantId} className="flex items-center gap-6 py-7 border-b border-[#f0f0f0]">
              <div className="w-[90px] h-[110px] bg-[#F5F3EF] flex-shrink-0 overflow-hidden">
                {item.image ? (
                  <img src={item.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-2xl font-thin text-[#D5D0C8]">Z</span>
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-[#1A1614] mb-1 tracking-wide">{item.name}</h3>
                <p className="text-[12px] text-[#aaa] mb-1.5">{item.size} · {item.color}</p>
                <p className="text-[13px] text-[#888] font-medium">{formatPrice(item.price)}</p>
              </div>
              <div className="hidden md:block text-[12px] text-[#888] font-medium">
                <span>Qté: {item.qty}</span>
              </div>
              <div className="text-[15px] font-semibold text-[#1A1614] min-w-[80px] text-right">
                {formatPrice(item.price * item.qty)}
              </div>
              {!directItem && (
                <button 
                  className="w-9 h-9 flex items-center justify-center bg-none border border-[#f0f0f0] cursor-pointer text-[#ccc] transition-all hover:border-[#C23616] hover:text-[#C23616]" 
                  onClick={() => removeFromCart(item.variantId)} 
                  aria-label="Supprimer"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* ═══ CHECKOUT SIDEBAR ═══ */}
        <div className="bg-[#FAFAF8] p-9 sticky top-[100px] border border-[#f0f0f0] rounded-sm">
          <h2 className="text-[13px] font-normal tracking-[0.2em] mb-7 text-[#1A1614] uppercase">LIVRAISON</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="space-y-2">
              <label className="block text-[10px] font-medium tracking-[0.12em] text-[#999] uppercase">NOM COMPLET</label>
              <input 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Aminata Traoré" 
                required 
                className="w-full p-3.5 border border-[#e8e8e4] bg-white text-sm text-[#1A1614] outline-none transition-colors focus:border-[#1A1614]"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-medium tracking-[0.12em] text-[#999] uppercase">TÉLÉPHONE</label>
              <input 
                value={phone} 
                onChange={e => setPhone(e.target.value)} 
                placeholder="07 00 00 00 00" 
                required 
                className="w-full p-3.5 border border-[#e8e8e4] bg-white text-sm text-[#1A1614] outline-none transition-colors focus:border-[#1A1614]"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-medium tracking-[0.12em] text-[#999] uppercase">DEUXIÈME TÉLÉPHONE (FACULTATIF)</label>
              <input 
                value={phone2} 
                onChange={e => setPhone2(e.target.value)} 
                placeholder="05 00 00 00 00" 
                className="w-full p-3.5 border border-[#e8e8e4] bg-white text-sm text-[#1A1614] outline-none transition-colors focus:border-[#1A1614]"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-medium tracking-[0.12em] text-[#999] uppercase">COMMUNE</label>
              <select 
                value={commune} 
                onChange={e => {
                  const nextCommune = e.target.value;
                  if (nextCommune === 'Boutique' || commune === 'Boutique') setAddress('');
                  setCommune(nextCommune);
                }}
                required
                className="w-full p-3.5 border border-[#e8e8e4] bg-white text-sm text-[#1A1614] outline-none transition-colors focus:border-[#1A1614]"
              >
                <option value="">Sélectionner</option>
                {communes.map((c: Commune) => <option key={c.id} value={c.name}>{c.name} (+{c.deliveryFee.toLocaleString()} F)</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-medium tracking-[0.12em] text-[#999] uppercase">{commune === 'Boutique' ? 'POINT RELAIS' : 'ADRESSE PRÉCISE'}</label>
              {commune === 'Boutique' ? (
                <select value={address} onChange={e => setAddress(e.target.value)} required className="w-full p-3.5 border border-[#e8e8e4] bg-white text-sm text-[#1A1614] outline-none transition-colors focus:border-[#1A1614]">
                  <option value="">Sélectionner un point relais</option>
                  {relayPoints.map((relayPoint) => <option key={relayPoint} value={relayPoint}>{relayPoint}</option>)}
                </select>
              ) : (
                <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Quartier, rue, repères..." rows={3} required className="w-full p-3.5 border border-[#e8e8e4] bg-white text-sm text-[#1A1614] outline-none transition-colors focus:border-[#1A1614] resize-vertical font-inherit" />
              )}
            </div>

            {/* Saisie de code promo */}
            <div className="border-t border-[#e8e8e4] pt-4 mt-2">
              {!appliedPromo ? (
                <div>
                  {!showPromoInput ? (
                    <button
                      type="button"
                      onClick={() => setShowPromoInput(true)}
                      className="text-[11px] font-semibold tracking-[0.12em] text-[#1A1614] hover:text-[#D4541C] transition-colors flex items-center gap-1.5 uppercase bg-none border-none p-0 cursor-pointer"
                    >
                      <Tag size={13} /> J'ai un code promo
                    </button>
                  ) : (
                    <div className="space-y-2 animate-[fadeIn_0.3s_ease]">
                      <div className="flex justify-between items-center">
                        <label className="block text-[10px] font-medium tracking-[0.12em] text-[#999] uppercase">CODE PROMO</label>
                        <button
                          type="button"
                          onClick={() => { setShowPromoInput(false); setPromoError(null); }}
                          className="text-[10px] text-[#aaa] hover:text-[#1A1614] bg-none border-none p-0 cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={promoInput}
                          onChange={e => setPromoInput(e.target.value.toUpperCase())}
                          placeholder="EX: SUMMER20"
                          className="flex-1 p-2.5 border border-[#e8e8e4] bg-white text-xs text-[#1A1614] uppercase outline-none focus:border-[#1A1614] tracking-wider"
                          disabled={isValidatingPromo}
                        />
                        <button
                          type="button"
                          onClick={handleApplyPromo}
                          disabled={isValidatingPromo || !promoInput.trim()}
                          className="px-4 bg-[#1A1614] text-white border-none text-[10px] font-bold tracking-[0.1em] cursor-pointer hover:bg-[#333] disabled:opacity-40 transition-colors uppercase"
                        >
                          {isValidatingPromo ? "..." : "APPLIQUER"}
                        </button>
                      </div>
                      {promoError && (
                        <p className="text-[11px] text-[#C23616] mt-1 font-medium">{promoError}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between bg-[#F1EFEA] px-3.5 py-2.5 border border-[#E4E0D5] animate-[fadeIn_0.3s_ease]">
                  <div className="flex items-center gap-2">
                    <Tag size={13} className="text-[#D4541C]" />
                    <span className="text-xs font-semibold tracking-wider text-[#1A1614] uppercase">{appliedPromo}</span>
                    <span className="text-[10px] text-[#888] font-medium">({discount.label || 'Appliqué'})</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="text-[10px] font-semibold text-[#C23616] hover:text-[#9c250b] bg-none border-none p-0 cursor-pointer tracking-wider uppercase"
                  >
                    Retirer
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-[#e8e8e4] pt-5 flex flex-col gap-3">
              <div className="flex justify-between text-[13px] text-[#888] font-normal"><span>Sous-total</span><span>{formatPrice(checkoutTotal)}</span></div>
              <div className="flex justify-between text-[13px] text-[#888] font-normal"><span>Livraison</span><span>{deliveryFee > 0 ? formatPrice(deliveryFee) : '—'}</span></div>
              
              {discount.amount > 0 && (
                <div className="flex justify-between text-[13px] text-[#D4541C] font-semibold animate-pulse">
                  <span className="flex items-center gap-1.5"><Tag size={14} /> {discount.label || 'Remise automatique'}</span>
                  <span>-{formatPrice(discount.amount)}</span>
                </div>
              )}

              {discount.type === 'GIFT' && (
                <div className="flex justify-between text-[13px] text-green-600 font-semibold animate-pulse">
                  <span className="flex items-center gap-1.5">🎁 Cadeau inclus ({discount.label})</span>
                  <span>Offert</span>
                </div>
              )}

              <div className="flex justify-between text-lg font-semibold text-[#1A1614] pt-3 border-t border-[#e8e8e4] mt-1"><span>Total</span><span>{formatPrice(grandTotal)}</span></div>
            </div>

            <button 
              className="w-full h-[52px] bg-[#1A1614] text-white border-none text-[12px] font-semibold tracking-[0.15em] cursor-pointer flex items-center justify-center gap-2.5 transition-all duration-350 hover:enabled:bg-[#333] hover:enabled:-translate-y-0.5 hover:enabled:shadow-[0_8px_24px_rgba(0,0,0,0.1)] disabled:opacity-50 disabled:cursor-not-allowed" 
              type="submit" 
              disabled={isPending}
            >
              {isPending ? "TRAITEMENT..." : "CONFIRMER LA COMMANDE"}
              {!isPending && <ArrowRight size={16} />}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#bbb] mt-1">
              <ShieldCheck size={14} /> Paiement sécurisé · Livraison suivie
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
