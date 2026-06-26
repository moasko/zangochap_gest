"use client";

import React, { useState, useMemo, useTransition, useEffect, startTransition, useRef } from "react";
import { TableCard, StatusBadge, EmptyState, DetailCard, SectionLabel, StatCard, LocationBadge } from "@/components/UI";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { updateProductVariants, markProductSent, deleteProduct, updateProduct, createProduct, fixAllProductStocks } from "@/modules/products/actions";
import { formatPrice, formatDay, CATEGORIES } from "@/lib/constants";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Eye, Package, Trash2, Minus, Search, X, ChevronLeft, ChevronRight, RefreshCw, Copy, Edit3, Box, Maximize, LayoutDashboard, AlertTriangle, MapPin, Save, Edit2, Warehouse, Check, ChevronsUpDown } from "lucide-react";
import Topbar from "@/components/Topbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, getImageUrl } from "@/lib/utils";
import VariantsEditorModal from "../../logistics/packing/components/VariantsEditorModal";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";

const PRODUCTS_PER_PAGE = 30;
const PRODUCTS_PAGE_STORAGE_KEY = 'zango-products-last-page';

interface ProductsClientProps {
  initialProducts: any[];
  user: any;
  totalCount: number;
  oosCount: number;
  currentPage: number;
  pageSize: number;
  categories?: any[];
  suppliers?: any[];
}

export default function ProductsClient({ initialProducts, user, totalCount, oosCount, currentPage: serverPage, pageSize, categories = [], suppliers = [] }: ProductsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filter, setFilter] = useState(searchParams.get('filter') || 'all');
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  const currentPage = serverPage;
  const totalPages = Math.ceil(totalCount / pageSize);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [editingVariants, setEditingVariants] = useState<any>(null);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const { showToast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  // Debounced search — 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync state to URL
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (filter !== 'all') params.set('filter', filter); else params.delete('filter');
    if (debouncedSearch) params.set('q', debouncedSearch); else params.delete('q');
    params.set('page', '1');
    router.push(`?${params.toString()}`);
  }, [filter, debouncedSearch, router]);

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`?${params.toString()}`);
  };

  // Garde la page de pagination en memoire : au retour sur le catalogue (sidebar, apres
  // edition d'un produit, rechargement) on restaure la derniere page consultee.
  const didRestorePage = useRef(false);
  useEffect(() => {
    if (didRestorePage.current) return;
    didRestorePage.current = true;
    // Une URL explicite (page / filtre / recherche) a toujours la priorite.
    if (searchParams.get('page') || searchParams.get('filter') || searchParams.get('q')) return;
    try {
      const saved = parseInt(localStorage.getItem(PRODUCTS_PAGE_STORAGE_KEY) || '', 10);
      if (saved > 1 && saved <= totalPages) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('page', String(saved));
        router.replace(`?${params.toString()}`);
      }
    } catch { /* localStorage indisponible */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On ne memorise que la pagination du catalogue principal (sans filtre ni recherche).
  useEffect(() => {
    try {
      if (filter === 'all' && !debouncedSearch) {
        localStorage.setItem(PRODUCTS_PAGE_STORAGE_KEY, String(currentPage));
      }
    } catch { /* localStorage indisponible */ }
  }, [currentPage, filter, debouncedSearch]);

  const paginatedProducts = initialProducts;

  // Stats (some might be approximate if only looking at current page, but oosCount is passed from server)
  const low = initialProducts.filter(p => {
    const realStock = p.variants?.length > 0 ? p.variants.reduce((s: number, v: any) => s + (v.stock || 0), 0) : p.stock;
    return realStock > 0 && realStock <= p.lowStockThreshold;
  }).length;
  const totalUnits = initialProducts.reduce((s: number, p: any) => s + (p.variants?.reduce((ss: number, v: any) => ss + (v.stock || 0), 0) || p.stock), 0);

  return (
    <>
      <Topbar
        title="Gestion des"
        subtitle="produits"
        actions={
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn-secondary"
              onClick={async () => {
                setIsSyncing(true);
                try {
                  const res = await fixAllProductStocks();
                  showToast(`${res.count} produits synchronisés ✓`, 'success');
                  router.refresh();
                } catch (e) {
                  if (reloadOnStaleServerAction(e)) return;
                  showToast('Erreur de synchronisation', 'error');
                } finally {
                  setIsSyncing(false);
                }
              }}
              disabled={isSyncing}
            >
              <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Synchro...' : 'Sync Stocks'}
            </button>
            <button className="btn-orange" onClick={() => router.push('/zangochap-manager/products/new')}>
              <Plus size={16} /> Nouveau Produit
            </button>
          </div>
        }
      />

      {/* LIGHTBOX / ZOOM IMAGE */}
      {selectedImage && (
        <div
          className="lightbox-overlay"
          onClick={() => setSelectedImage(null)}
        >
          <div className="lightbox-content animate-zoom-in" onClick={e => e.stopPropagation()}>
            <img src={getImageUrl(selectedImage)} alt="Preview" />
            <button className="lightbox-close" onClick={() => setSelectedImage(null)}>
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      <div className="content animate-fade-in">
        {/* STATS */}
        <div className="stats-grid stats-grid-compact">
          <StatCard label="Produits" value={initialProducts.length} compact />
          <StatCard label="Unités en stock" value={totalUnits} compact />
          <StatCard label="Stock faible" value={low} color="var(--amber)" trend="Seuil atteint" trendDir="down" compact />
          <StatCard label="Ruptures" value={oosCount} color="var(--red)" compact />
        </div>

        {/* SEARCH */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--brown-soft)' }} />
          <input
            type="text"
            className="field-input"
            placeholder="Rechercher par nom, fournisseur, emplacement..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 40, borderRadius: 12, height: 38, fontSize: 13, fontWeight: 500 }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: '#DEE2E6', border: 'none', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--brown-soft)' }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* FILTERS */}
        <div className="filters-bar">
          {[
            { key: 'all', label: 'Tous' },
            { key: 'oos', label: 'En rupture' },
            { key: 'low', label: 'Stock faible' },
            { key: 'in-stock', label: 'En stock' },
          ].map(f => (
            <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
          <div className="filter-spacer" />
          <button className="btn-secondary" onClick={() => router.refresh()} title="Actualiser" style={{ padding: '8px 10px' }}>
            <RefreshCw size={14} />
          </button>
          <a href="/zangochap-manager/products/new" className="btn-orange">
            <Plus size={14} /> Nouveau produit
          </a>
        </div>

        {/* TABLE */}
        <TableCard title="Catalogue" meta={`${totalCount} produit(s) · Page ${currentPage}/${totalPages}`}>
          {initialProducts.length === 0 ? (
            <EmptyState icon="📦" title="Aucun produit" description="Aucun produit trouvé." />
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Prix</th>
                    <th>Promo</th>
                    <th>Variantes</th>
                    <th>Emplacement</th>
                    <th>Fournisseur</th>
                    <th>Stock</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div
                            style={{ width: 48, height: 48, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', cursor: 'zoom-in', flexShrink: 0, background: 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => p.images?.[0] && setSelectedImage(getImageUrl(p.images[0].url))}
                            className="hover-scale"
                          >
                            {p.images?.[0] ? (
                              <img
                                src={getImageUrl(p.images[0].url)}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s' }}
                                alt=""
                              />
                            ) : (
                              <span style={{ fontSize: 20 }}>{p.emoji || '📦'}</span>
                            )}
                          </div>
                          <div>
                            <div className="cell-strong" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {p.name}
                              {p.isFeatured && <span title="Mis en avant" style={{ color: '#EAB308' }}>⭐</span>}
                              {p.isGift && <span title="Produit Cadeau" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--orange-soft)', color: 'var(--orange)', borderRadius: 10, fontWeight: 800 }}>Cadeau</span>}
                              {p.status !== 'PUBLISHED' && <span title="Non publié" style={{ fontSize: 10, padding: '1px 4px', background: '#FEE2E2', color: '#EF4444', borderRadius: 4, fontWeight: 700 }}>Privé</span>}
                            </div>
                            <div className="cell-muted">{p.category?.name || 'Non catégorisé'} {p.subCategory ? ` > ${p.subCategory.name}` : ''} • {p.material || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="cell-price">{formatPrice(Number(p.price))}</span></td>
                      <td>{p.oldPrice ? <span className="cell-muted" style={{ textDecoration: 'line-through' }}>{formatPrice(Number(p.oldPrice))}</span> : '—'}</td>
                      <td><span className="cell-muted">{p.variants?.length || 0} variante(s)</span></td>
                      <td><LocationBadge location={p.location} /></td>
                      <td><span className="cell-muted">{p.supplier?.name || '—'}</span></td>
                      <td>
                        {(() => {
                          const realStock = p.variants?.length > 0 ? p.variants.reduce((s: number, v: any) => s + (v.stock || 0), 0) : p.stock;
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                                background: realStock === 0 ? 'var(--red)' : realStock <= p.lowStockThreshold ? 'var(--amber)' : 'var(--green)'
                              }} />
                              <div>
                                <strong style={{ color: realStock === 0 ? 'var(--red)' : realStock <= p.lowStockThreshold ? 'var(--amber)' : 'var(--green)', fontSize: 14 }}>
                                  {realStock}
                                </strong>
                                <div style={{ fontSize: 10, fontWeight: 600, color: realStock === 0 ? 'var(--red)' : realStock <= p.lowStockThreshold ? 'var(--amber)' : 'var(--brown-soft)' }}>
                                  {realStock === 0 ? 'Rupture' : realStock <= p.lowStockThreshold ? 'Stock bas' : 'En stock'}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="action-btn" title="Détail" onClick={() => setSelectedProduct(p)}>
                            <Eye size={14} />
                          </button>
                          <button className="action-btn" title="Modifier" onClick={() => router.push(`/zangochap-manager/products/${p.id}/edit`)} style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                            <Edit3 size={14} />
                          </button>
                          <button className="action-btn" title="Dupliquer" onClick={() => handleDuplicate(p)} style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                            <Copy size={14} />
                          </button>
                          <button className="action-btn" title="Stock & variantes" onClick={() => openVariantsEditor(p)} style={{ background: 'var(--orange-soft)', color: 'var(--orange)' }}>
                            <Package size={14} />
                          </button>
                          <button className="action-btn" title="Supprimer" onClick={() => handleDelete(p.id)} style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* PAGINATION */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--cream)' }}>
                  <div style={{ fontSize: 12, color: 'var(--brown-soft)', fontWeight: 500 }}>
                    {((currentPage - 1) * PRODUCTS_PER_PAGE) + 1}–{Math.min(currentPage * PRODUCTS_PER_PAGE, totalCount)} sur {totalCount}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="action-btn" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} style={{ opacity: currentPage <= 1 ? 0.3 : 1 }}>
                      <ChevronLeft size={16} />
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 5) page = i + 1;
                      else if (currentPage <= 3) page = i + 1;
                      else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                      else page = currentPage - 2 + i;
                      return (
                        <button key={page} onClick={() => goToPage(page)} style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: currentPage === page ? 'var(--ink)' : 'white', color: currentPage === page ? 'white' : 'var(--brown)', boxShadow: currentPage === page ? 'none' : '0 1px 2px rgba(0,0,0,0.06)', transition: 'all 0.15s' }}>
                          {page}
                        </button>
                      );
                    })}
                    <button className="action-btn" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)} style={{ opacity: currentPage >= totalPages ? 0.3 : 1 }}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </TableCard>
      </div>

        {/* PRODUCT DETAIL MODAL */}
        {selectedProduct && (
          <ProductDetailModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onEditVariants={() => { setSelectedProduct(null); openVariantsEditor(selectedProduct); }}
            onShowImage={setSelectedImage}
          />
        )}

        {/* VARIANTS EDITOR MODAL */}
        {editingVariants && (
          <VariantsEditorModal
            product={editingVariants.product}
            variants={editingVariants.variants}
            onClose={() => setEditingVariants(null)}
            onSave={() => {
              showToast('Stock mis a jour', 'success');
              setEditingVariants(null);
              router.refresh();
            }}
          />
        )}


      {/* IMMERSIVE LIGHTBOX */}
      {selectedImage && (
        <div
          className="lightbox-overlay"
          onClick={() => setSelectedImage(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', cursor: 'zoom-out' }}
        >
          <div className="lightbox-content animate-zoom-in" onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src={getImageUrl(selectedImage)}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
            />
            <button
              className="lightbox-close"
              onClick={() => setSelectedImage(null)}
              style={{ position: 'absolute', top: -40, right: 0, background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </>
  );

  function openVariantsEditor(product: any) {
    setEditingVariants({
      product,
      variants: JSON.parse(JSON.stringify(product.variants || [])),
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Voulez-vous vraiment supprimer ce produit ? Cette action est irréversible.')) return;
    startTransition(async () => {
      try {
        await deleteProduct(id);
        showToast('Produit supprimé', 'success');
        router.refresh();
      } catch (e: any) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e.message || 'Erreur', 'error');
      }
    });
  }

  function handleDuplicate(product: any) {
    if (!confirm(`Dupliquer le produit "${product.name}" ?`)) return;
    startTransition(async () => {
      try {
        await createProduct({
          name: `${product.name} (Copie)`,
          category: product.category?.name || product.category || "",
          subCategory: product.subCategory?.name || product.subCategory || "",
          price: Number(product.price),
          oldPrice: product.oldPrice ? Number(product.oldPrice) : null,
          description: product.description,
          material: product.material,
          origin: product.origin,
          supplier: product.supplier?.name || product.supplier || "",
          location: product.location,
          lowStockThreshold: product.lowStockThreshold,
          variants: (product.variants || []).map((v: any) => ({
            size: v.size,
            color: v.color,
            stock: 0, // Don't duplicate stock
            location: v.location,
          })),
          images: (product.images || []).map((img: any) => ({
            name: img.name,
            dataUrl: img.url,
          })),
        });
        showToast('Produit dupliqué ✓', 'success');
        router.refresh();
      } catch (e: any) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e.message || 'Erreur', 'error');
      }
    });
  }
}

// ============================================
// PRODUCT DETAIL MODAL
// ============================================
function ProductDetailModal({ product: p, onClose, onEditVariants, onShowImage }: { product: any; onClose: () => void; onEditVariants: () => void; onShowImage: (url: string) => void }) {
  return (
    <Modal isOpen={true} onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Box size={18} className="text-orange" />
          <span>Fiche Produit</span>
        </div>
      }
      footer={
        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onEditVariants}>
            <Edit3 size={16} /> Modifier le stock
          </button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={onClose}>Fermer</button>
        </div>
      }
    >
      <div className="product-detail-modal-layout">
        {p.images?.[0] && (
          <div className="product-detail-image-section">
            <img
              src={getImageUrl(p.images[0].url)}
              className="product-detail-hero-img"
              onClick={() => onShowImage(getImageUrl(p.images[0].url))}
            />
            <div className="image-zoom-hint"><Maximize size={12} /> Cliquer pour agrandir</div>
          </div>
        )}

        <div className="product-detail-info-header">
          <div className="category-tag">{p.category?.name || p.category || 'Non catégorisé'} {p.subCategory ? ` > ${p.subCategory.name}` : ''}</div>
          <h2 className="product-detail-name">{p.name}</h2>
          <div className="product-detail-price-row">
            <span className="price-main">{formatPrice(Number(p.price))}</span>
            {p.oldPrice && <span className="price-old">{formatPrice(Number(p.oldPrice))}</span>}
          </div>
        </div>

        <div className="product-detail-grid">
          <div className="detail-item-box">
            <label>Fournisseur</label>
            <div className="detail-val">{p.supplier?.name || 'Non défini'}</div>
          </div>
          <div className="detail-item-box">
            <label>Provenance</label>
            <div className="detail-val">{p.origin || '—'}</div>
          </div>
          <div className="detail-item-box">
            <label>Matière</label>
            <div className="detail-val">{p.material || '—'}</div>
          </div>
          <div className="detail-item-box">
            <label>Stock Total</label>
            <div className={`detail-val stock-val ${p.stock === 0 ? 'out' : p.stock < 5 ? 'low' : ''}`}>
              {p.stock} unités
            </div>
          </div>
        </div>

        {p.description && (
          <div className="product-detail-desc">
            <label>Description</label>
            <p>{p.description}</p>
          </div>
        )}

        <div className="product-detail-variants-section">
          <div className="section-header-mini">
            <LayoutDashboard size={14} />
            <span>Variantes & Emplacements</span>
          </div>

          <div className="variants-mini-table">
            {p.variants?.length ? (
              <table>
                <thead>
                  <tr><th>Taille</th><th>Couleur</th><th>Stock</th><th>Lieu</th></tr>
                </thead>
                <tbody>
                  {p.variants.map((v: any) => (
                    <tr key={v.id}>
                      <td><span className="variant-tag-sm">{v.size}</span></td>
                      <td><span className="color-label">{v.color}</span></td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className={`stock-badge-sm ${v.stock === 0 ? 'red' : v.stock < 3 ? 'orange' : 'green'}`}>
                            Total: {v.stock}
                          </span>
                          {v.stockLevels?.map((sl: any) => (
                            <div key={sl.id} style={{ fontSize: 10, color: 'var(--brown-soft)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Warehouse size={10} /> {sl.warehouse.name}: <strong>{sl.quantity}</strong>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td><LocationBadge location={v.location} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-mini">Aucune variante configurée</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

