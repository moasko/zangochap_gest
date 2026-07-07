"use client";

import React, { useState, useMemo, useEffect } from "react";
import { formatPrice } from "@/lib/constants";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Filter, X, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Product, Category } from "@/lib/types";
import ProductCard from "@/components/public/ProductCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ShopClient({ initialProducts, categories }: { 
  initialProducts: Product[], 
  categories: Category[] 
}) {
  const searchParams = useSearchParams();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(searchParams.get("category") || null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState<number>(500000);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 24;

  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat) {
      setSelectedCategory(cat);
      setCurrentPage(1);
    }
  }, [searchParams]);

  // Filter Logic
  const filteredProducts = useMemo(() => {
    let result = [...initialProducts];

    if (selectedCategory) {
      result = result.filter(p => p.category?.name === selectedCategory);
    }
    if (selectedSubCategory) {
      result = result.filter(p => p.subCategory?.name === selectedSubCategory);
    }

    result = result.filter(p => Number(p.price) <= priceRange);

    if (sortBy === "price-asc") result.sort((a, b) => Number(a.price) - Number(b.price));
    if (sortBy === "price-desc") result.sort((a, b) => Number(b.price) - Number(a.price));
    if (sortBy === "newest") result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return result;
  }, [initialProducts, selectedCategory, selectedSubCategory, priceRange, sortBy]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Pagination fenetree : premiere, derniere, page courante +/-1, avec ellipses.
  // Evite qu'une longue rangee de numeros deborde de l'ecran sur mobile.
  const pageItems = useMemo<(number | "…")[]>(() => {
    if (totalPages <= 1) return [];
    const items: (number | "…")[] = [];
    let last = 0;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        if (last && i - last > 1) items.push("…");
        items.push(i);
        last = i;
      }
    }
    return items;
  }, [totalPages, currentPage]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo(0, 0);
  };

  return (
    <div className="bg-white min-h-screen py-10 font-body w-full">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        {/* HEADER */}
        <div className="mb-8">
          <div className="text-[10px] tracking-[0.2em] text-[#D4541C] mb-3 font-extrabold uppercase">
            ACCUEIL / BOUTIQUE
          </div>
          <h1 className="font-display text-[36px] font-bold tracking-tight mb-5 text-[#1A1614]">
            NOTRE COLLECTION
          </h1>
          <div className="flex justify-between items-center pb-2.5 border-b border-[#eee] mb-5">
            <button 
              className="flex items-center gap-2 bg-none border border-[#1A1614] px-4 py-2 text-[11px] font-semibold cursor-pointer"
              onClick={() => setShowFilters(true)}
            >
              <SlidersHorizontal size={16} /> FILTRER
            </button>
            <Select 
              value={sortBy} 
              onValueChange={(val) => { if (val) { setSortBy(val); setCurrentPage(1); } }}
            >
              <SelectTrigger className="border-none bg-transparent shadow-none text-[11px] font-semibold tracking-wider uppercase focus:ring-0 w-auto gap-2 p-0 h-auto">
                <SelectValue placeholder="Trier par" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">NOUVEAUTÉS</SelectItem>
                <SelectItem value="price-asc">PRIX CROISSANT</SelectItem>
                <SelectItem value="price-desc">PRIX DÉCROISSANT</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* MOBILE CATEGORY CHIPS (Horizontal Scroll) */}
        <div className="lg:hidden -mx-4 px-4 flex overflow-x-auto gap-3 pb-4 mb-6 scrollbar-hide">
          <button 
            onClick={() => { setSelectedCategory(null); setSelectedSubCategory(null); setCurrentPage(1); }}
            className={`whitespace-nowrap px-5 py-2.5 rounded-full text-[10px] font-extrabold tracking-widest transition-all border ${!selectedCategory ? 'bg-[#1A1614] text-white border-[#1A1614]' : 'bg-white text-[#1A1614] border-[#eee]'}`}
          >
            TOUT VOIR
          </button>
          {categories.map((cat: Category) => (
            <button 
              key={cat.id}
              onClick={() => { setSelectedCategory(cat.name); setSelectedSubCategory(null); setCurrentPage(1); }}
              className={`whitespace-nowrap px-5 py-2.5 rounded-full text-[10px] font-extrabold tracking-widest transition-all border ${selectedCategory === cat.name ? 'bg-[#1A1614] text-white border-[#1A1614]' : 'bg-white text-[#1A1614] border-[#eee]'}`}
            >
              {cat.name.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* SIDEBAR FILTERS (Desktop) */}
          <aside className="hidden lg:block w-[200px] flex-shrink-0">
            <div className="mb-5">
              <h3 className="text-[12px] font-bold tracking-widest mb-5 uppercase text-[#1A1614]">CATÉGORIES</h3>
              <div className="flex flex-col gap-3">
                <button 
                  className={`text-left bg-none border-none text-[13px] cursor-pointer p-0 transition-colors ${!selectedCategory ? "text-[#1A1614] font-bold" : "text-[#666]"}`} 
                  onClick={() => { setSelectedCategory(null); setSelectedSubCategory(null); setCurrentPage(1); }}
                >
                  Tout voir
                </button>
                {categories.map((cat: Category) => (
                  <div key={cat.id}>
                    <button 
                      className={`w-full text-left bg-none border-none text-[13px] cursor-pointer p-0 transition-colors flex justify-between items-center ${selectedCategory === cat.name && !selectedSubCategory ? "text-[#1A1614] font-bold" : "text-[#666]"}`}
                      onClick={() => { setSelectedCategory(cat.name); setSelectedSubCategory(null); setCurrentPage(1); }}
                    >
                      {cat.name} <span className="text-[#ccc] text-[11px]">({cat._count?.products || 0})</span>
                    </button>
                    {(selectedCategory === cat.name || cat.subCategories?.some((s: any) => s.name === selectedSubCategory)) && cat.subCategories && cat.subCategories.length > 0 && (
                      <div className="flex flex-col gap-2 mt-2 ml-3 pl-2 border-l border-[#eee]">
                        {cat.subCategories.map((sub: any) => (
                          <button
                            key={sub.id}
                            className={`text-left bg-none border-none text-[12px] cursor-pointer p-0 transition-colors ${selectedSubCategory === sub.name ? "text-[#D4541C] font-bold" : "text-[#888]"}`}
                            onClick={() => { setSelectedCategory(cat.name); setSelectedSubCategory(sub.name); setCurrentPage(1); }}
                          >
                            {sub.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <h3 className="text-[12px] font-bold tracking-widest mb-5 uppercase text-[#1A1614]">PRIX MAX</h3>
              <div className="space-y-3">
                <input 
                  type="range" 
                  min="0" 
                  max="500000" 
                  step="5000"
                  className="w-full accent-[#1A1614] cursor-pointer"
                  value={priceRange} 
                  onChange={(e) => { setPriceRange(Number(e.target.value)); setCurrentPage(1); }} 
                />
                <div className="flex justify-between text-[12px] font-semibold text-[#1A1614]">
                  <span>0 F</span>
                  <span>{formatPrice(priceRange)}</span>
                </div>
              </div>
            </div>
          </aside>

          {/* MAIN GRID */}
          <main className="flex-1">
            <div className="text-[10px] text-[#999] mb-6 tracking-wider uppercase">
              {filteredProducts.length} PRODUITS TROUVÉS
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 md:gap-x-6 gap-y-10 md:gap-y-12">
              {paginatedProducts.map((p: Product) => (
                <ProductCard p={p} key={p.id} />
              ))}
            </div>

            {/* PAGINATION UI — fenetree, fleches compactes, ne deborde pas sur mobile */}
            {totalPages > 1 && (
              <div className="flex flex-wrap justify-center items-center gap-1.5 sm:gap-2 mt-[60px] pt-10 border-t border-[#eee]">
                <button
                  className="w-10 h-10 flex items-center justify-center bg-none border border-[#eee] cursor-pointer transition-colors hover:enabled:border-[#1A1614] disabled:opacity-30 disabled:cursor-not-allowed"
                  disabled={currentPage === 1}
                  onClick={() => goToPage(currentPage - 1)}
                  aria-label="Page précédente"
                >
                  <ChevronLeft size={16} />
                </button>
                {pageItems.map((item, idx) =>
                  item === "…" ? (
                    <span key={`dots-${idx}`} className="w-6 h-10 flex items-center justify-center text-[12px] text-[#bbb] select-none">…</span>
                  ) : (
                    <button
                      key={item}
                      className={`min-w-[40px] h-[40px] border text-[11px] font-semibold cursor-pointer transition-colors ${currentPage === item ? "bg-[#1A1614] text-white border-[#1A1614]" : "bg-none border-[#eee] hover:border-[#1A1614]"}`}
                      onClick={() => goToPage(item)}
                      aria-label={`Page ${item}`}
                      aria-current={currentPage === item ? "page" : undefined}
                    >
                      {item}
                    </button>
                  )
                )}
                <button
                  className="w-10 h-10 flex items-center justify-center bg-none border border-[#eee] cursor-pointer transition-colors hover:enabled:border-[#1A1614] disabled:opacity-30 disabled:cursor-not-allowed"
                  disabled={currentPage === totalPages}
                  onClick={() => goToPage(currentPage + 1)}
                  aria-label="Page suivante"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {filteredProducts.length === 0 && (
              <div className="text-center py-[100px]">
                <p className="text-[#666]">Aucun produit ne correspond à vos critères.</p>
                <button 
                  className="mt-5 bg-[#1A1614] text-white border-none px-6 py-2.5 text-[11px] font-semibold cursor-pointer uppercase transition-transform active:scale-95"
                  onClick={() => {setSelectedCategory(null); setSelectedSubCategory(null); setPriceRange(500000);}}
                >
                  Réinitialiser
                </button>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* MOBILE FILTERS OVERLAY */}
      <div className={`fixed inset-0 bg-white z-[1000] flex flex-col transition-transform duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] ${showFilters ? "translate-y-0" : "translate-y-full"}`}>
        <div className="p-5 border-b border-[#eee] flex justify-between items-center">
          <h2 className="text-lg font-bold tracking-tight">FILTRER</h2>
          <button className="bg-none border-none cursor-pointer p-1" onClick={() => setShowFilters(false)}><X /></button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
           <div className="mb-8">
              <h3 className="text-[12px] font-bold tracking-widest mb-5 uppercase text-[#1A1614]">CATÉGORIES</h3>
              <div className="grid grid-cols-2 gap-2.5">
                {categories.map((cat: Category) => (
                  <button 
                    key={cat.id}
                    className={`p-3 border text-[11px] font-bold rounded transition-colors ${selectedCategory === cat.name && !selectedSubCategory ? "bg-[#1A1614] text-white border-[#1A1614]" : "bg-white text-[#1A1614] border-[#eee]"}`}
                    onClick={() => {setSelectedCategory(cat.name); setSelectedSubCategory(null); setShowFilters(false);}}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
           </div>
        </div>
      </div>
    </div>

  );
}
