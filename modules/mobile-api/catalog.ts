// Catalogue public de l'API mobile (/api/mobile/v1). Module interne (pas une Server Action).
// Memes regles de visibilite que la boutique web (app/page.tsx, app/shop/page.tsx) :
// produits PUBLISHED, hors categories internes, hors articles cadeaux.
import prisma from "@/lib/prisma";
import { getAbsoluteUrl } from "@/lib/seo";

import { compareSizes, fuzzyScore, normalizeText } from "./text";

// Identiques au site (categories internes ou cadeaux, jamais vendues en vitrine).
export const HIDDEN_CATEGORY_NAMES = ["Entrepôts", "cadeau", "Cadeau", "Gift"];
const CACHE_TTL_MS = 60_000;
const SALES_WINDOW_DAYS = 30;
const NEW_PRODUCT_DAYS = 14;

export type CatalogEntry = {
  id: string;
  slug: string;
  name: string;
  ref: string | null;
  price: number;
  oldPrice: number | null;
  image: string | null;
  categoryId: string | null;
  categoryName: string | null;
  stock: number;
  soldCount: number;
  isFeatured: boolean;
  createdAt: string;
  // Texte normalise pour la recherche (nom, ref, categorie, tailles, couleurs).
  searchText: string;
};

export type ProductSort = "relevance" | "popular" | "newest" | "price_asc" | "price_desc" | "rating";

export type ProductQuery = {
  q?: string;
  categoryId?: string;
  subCategoryId?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: ProductSort;
  collection?: string;
  ids?: string[];
  excludeId?: string;
  page?: number;
  pageSize?: number;
};

type Snapshot = { at: number; entries: CatalogEntry[] };
let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;

export const publicProductWhere = {
  status: "PUBLISHED" as const,
  isGift: false,
  category: { name: { notIn: HIDDEN_CATEGORY_NAMES } },
};

/** Stock vendable : somme des variantes s'il y en a, sinon stock du produit. */
export function sellableStock(product: { stock: number; variants: { stock: number }[] }) {
  return product.variants.length > 0 ? product.variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0) : Math.max(0, product.stock);
}

export function absoluteImage(url: string | null | undefined) {
  if (!url) return null;
  const first = url.includes(";") ? url.split(";")[0] : url;
  return first.trim() ? getAbsoluteUrl(first.trim()) : null;
}

/** Image principale : mainImageId si renseignee, sinon la premiere par position. */
export function mainImage(product: { mainImageId: string | null; images: { id: string; url: string; position: number }[] }) {
  const sorted = [...product.images].sort((a, b) => a.position - b.position);
  return absoluteImage((sorted.find((image) => image.id === product.mainImageId) ?? sorted[0])?.url);
}

async function loadSnapshot(): Promise<Snapshot> {
  const since = new Date(Date.now() - SALES_WINDOW_DAYS * 86_400_000);
  const [products, sales] = await Promise.all([
    prisma.product.findMany({
      where: publicProductWhere,
      select: {
        id: true, slug: true, name: true, ref: true, price: true, oldPrice: true, stock: true, isFeatured: true,
        createdAt: true, categoryId: true, mainImageId: true,
        category: { select: { name: true } },
        images: { select: { id: true, url: true, position: true } },
        variants: { select: { size: true, color: true, stock: true } },
      },
    }),
    // Ventes 30 jours (hors cadeaux, annulations et retours) : base de « populaire » et « meilleures ventes ».
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        productId: { not: null },
        isGift: false,
        order: { deletedAt: null, createdAt: { gte: since }, status: { notIn: ["CANCELLED", "RETURNED"] } },
      },
      _sum: { qty: true },
    }),
  ]);
  const sold = new Map(sales.map((row) => [row.productId!, row._sum.qty ?? 0]));
  const entries = products.map((product): CatalogEntry => ({
    id: product.id,
    slug: product.slug,
    name: product.name.trim(),
    ref: product.ref,
    price: Number(product.price),
    oldPrice: product.oldPrice ? Number(product.oldPrice) : null,
    image: mainImage(product),
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    stock: sellableStock(product),
    soldCount: sold.get(product.id) ?? 0,
    isFeatured: product.isFeatured,
    createdAt: product.createdAt.toISOString(),
    searchText: normalizeText(
      [product.name, product.ref, product.category?.name, ...product.variants.map((v) => `${v.size} ${v.color}`)].filter(Boolean).join(" "),
    ),
  }));
  return { at: Date.now(), entries };
}

/** Instantane du catalogue public, rafraichi toutes les 60 s (un seul chargement concurrent). */
export async function getCatalog(): Promise<CatalogEntry[]> {
  if (snapshot && Date.now() - snapshot.at < CACHE_TTL_MS) return snapshot.entries;
  loading ??= loadSnapshot().finally(() => {
    loading = null;
  });
  snapshot = await loading;
  return snapshot.entries;
}

export function isDeal(entry: Pick<CatalogEntry, "price" | "oldPrice">) {
  return Boolean(entry.oldPrice && entry.oldPrice > entry.price);
}

function discountRate(entry: CatalogEntry) {
  return entry.oldPrice ? (entry.oldPrice - entry.price) / entry.oldPrice : 0;
}

/** Filtre, trie et pagine (fonction pure, testable). */
export function queryCatalog(entries: CatalogEntry[], query: ProductQuery) {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 20)));
  const q = query.q?.trim() ?? "";
  const ids = query.ids ? new Set(query.ids) : null;

  const scored = entries
    .map((entry) => ({ entry, score: q ? fuzzyScore(q, entry.searchText) : 1 }))
    .filter(({ entry, score }) =>
      score > 0
      && (!ids || ids.has(entry.id))
      && (!query.excludeId || entry.id !== query.excludeId)
      && (!query.categoryId || entry.categoryId === query.categoryId)
      && (query.minPrice === undefined || entry.price >= query.minPrice)
      && (query.maxPrice === undefined || entry.price <= query.maxPrice)
      && (!query.inStock || entry.stock > 0)
      && (query.collection !== "deals" || isDeal(entry)));

  const sort: ProductSort = query.sort
    ?? (query.collection === "new" ? "newest" : query.collection === "deals" ? "popular" : query.collection ? "popular" : q ? "relevance" : "popular");

  scored.sort((a, b) => {
    // Disponibles d'abord, quel que soit le tri.
    const stock = Number(b.entry.stock > 0) - Number(a.entry.stock > 0);
    if (stock !== 0) return stock;
    const byNewest = b.entry.createdAt.localeCompare(a.entry.createdAt);
    const bySales = b.entry.soldCount - a.entry.soldCount;
    switch (sort) {
      case "relevance":
        return b.score - a.score || bySales || byNewest;
      case "newest":
        return byNewest;
      case "price_asc":
        return a.entry.price - b.entry.price || byNewest;
      case "price_desc":
        return b.entry.price - a.entry.price || byNewest;
      default:
        // Populaire : mis en avant, puis ventes 30 j, puis (offres) remise, puis nouveaute.
        return Number(b.entry.isFeatured) - Number(a.entry.isFeatured) || bySales
          || (query.collection === "deals" ? discountRate(b.entry) - discountRate(a.entry) : 0) || byNewest;
    }
  });

  const total = scored.length;
  const items = scored.slice((page - 1) * pageSize, page * pageSize).map(({ entry }) => toSummary(entry));
  return { items, page, pageSize, total, hasMore: page * pageSize < total };
}

export function toSummary(entry: CatalogEntry) {
  return {
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    ref: entry.ref,
    price: entry.price,
    oldPrice: isDeal(entry) ? entry.oldPrice : null,
    image: entry.image,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName,
    brand: null,
    stock: entry.stock,
    soldCount: entry.soldCount,
    rating: null,
    createdAt: entry.createdAt,
  };
}

export function isNew(entry: Pick<CatalogEntry, "createdAt">, now = Date.now()) {
  return now - new Date(entry.createdAt).getTime() < NEW_PRODUCT_DAYS * 86_400_000;
}

/** Fiche complete (images ordonnees, variantes triees par taille). */
export async function getProductDetail(idOrSlug: string) {
  const product = await prisma.product.findFirst({
    where: { ...publicProductWhere, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      category: { select: { name: true } },
      subCategory: { select: { name: true } },
      images: { orderBy: { position: "asc" } },
      variants: true,
    },
  });
  if (!product) return null;
  const entries = await getCatalog();
  const entry = entries.find((item) => item.id === product.id);
  const images = [...product.images]
    .sort((a, b) => Number(b.id === product.mainImageId) - Number(a.id === product.mainImageId) || a.position - b.position)
    .map((image) => ({ url: absoluteImage(image.url), alt: image.altText || product.name }))
    .filter((image): image is { url: string; alt: string } => Boolean(image.url));
  const variants = [...product.variants]
    .sort((a, b) => a.color.localeCompare(b.color) || compareSizes(a.size, b.size))
    .map((variant) => ({ id: variant.id, size: variant.size.trim(), color: variant.color.trim(), stock: Math.max(0, variant.stock), image: absoluteImage(variant.image) }));
  const base = entry ? toSummary(entry) : {
    id: product.id, slug: product.slug, name: product.name.trim(), ref: product.ref, price: Number(product.price),
    oldPrice: product.oldPrice && Number(product.oldPrice) > Number(product.price) ? Number(product.oldPrice) : null,
    image: images[0]?.url ?? null, categoryId: product.categoryId, categoryName: product.category?.name ?? null, brand: null,
    stock: sellableStock(product), soldCount: 0, rating: null, createdAt: product.createdAt.toISOString(),
  };
  return {
    ...base,
    description: product.description,
    material: product.material,
    origin: product.origin,
    subCategoryId: product.subCategoryId,
    subCategoryName: product.subCategory?.name ?? null,
    lowStockThreshold: product.lowStockThreshold,
    images,
    variants,
  };
}

/** Produits associes : meme categorie, disponibles, les plus vendus. */
export async function getRelated(id: string, limit = 8) {
  const entries = await getCatalog();
  const product = entries.find((entry) => entry.id === id);
  if (!product) return [];
  return entries
    .filter((entry) => entry.id !== id && entry.stock > 0 && entry.categoryId === product.categoryId)
    .sort((a, b) => b.soldCount - a.soldCount || b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.min(20, limit))
    .map(toSummary);
}

/** Categories visibles ayant au moins un produit publie, avec une image representative. */
export async function getPublicCategories() {
  const entries = await getCatalog();
  const categories = await prisma.category.findMany({
    where: { name: { notIn: HIDDEN_CATEGORY_NAMES } },
    include: { subCategories: { select: { id: true, name: true, slug: true } } },
  });
  return categories
    .map((category) => {
      const products = entries.filter((entry) => entry.categoryId === category.id);
      const cover = [...products].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || b.soldCount - a.soldCount).find((p) => p.image);
      return { category, count: products.length, image: cover?.image ?? null };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ category, image, count }) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      image,
      productCount: count,
      subCategories: category.subCategories,
    }));
}

export async function getSuggestions(q: string) {
  const entries = await getCatalog();
  const products = queryCatalog(entries, { q, sort: "relevance", pageSize: 6 }).items;
  const categories = (await getPublicCategories())
    .filter((category) => fuzzyScore(q, normalizeText(category.name)) > 0)
    .slice(0, 4)
    .map(({ id, name, slug }) => ({ id, name, slug }));
  return { products, categories };
}
