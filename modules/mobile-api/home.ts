// Accueil de l'application construit depuis le CMS « home » du site (meme contenu, meme pilotage).
import { getAbsoluteUrl } from "@/lib/seo";
import { getHomeCmsContent } from "@/modules/cms/actions";

import { getPublicCategories } from "./catalog";

type LinkTarget =
  | { type: "collection"; key: string; title?: string }
  | { type: "category"; id: string }
  | { type: "product"; id: string }
  | { type: "url"; url: string };

type Category = { id: string; name: string };

/** Traduit un lien du site (« /shop?category=Chaussures », « /product/x », URL externe) en cible de l'app. */
export function hrefToTarget(href: string | undefined, categories: Category[]): LinkTarget {
  const value = (href ?? "").trim();
  if (/^https?:\/\//i.test(value)) return { type: "url", url: value };
  const [path, search = ""] = value.split("?");
  const product = path.match(/^\/product\/([^/]+)/);
  if (product) return { type: "product", id: decodeURIComponent(product[1]) };
  const category = new URLSearchParams(search).get("category");
  if (category) {
    // Le CMS du site ecrit « Accessoires » quand la categorie s'appelle « ACCESSOIRE » : casse,
    // accents et pluriel ignores, puis correspondance par debut de nom (« Vetements » → « Vêtements homme »).
    const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/s\b/g, "");
    const wanted = fold(category);
    const match = categories.find((c) => fold(c.name) === wanted) ?? categories.find((c) => fold(c.name).startsWith(wanted));
    if (match) return { type: "category", id: match.id };
  }
  return { type: "collection", key: "new", title: "Nouveautes" };
}

export async function getMobileHome() {
  const [cms, categories] = await Promise.all([getHomeCmsContent(), getPublicCategories()]);
  const image = (url: string) => (url ? getAbsoluteUrl(url) : null);

  const banners = [
    cms.heroImage && {
      id: "hero",
      title: cms.heroTitle,
      subtitle: cms.heroEyebrow || undefined,
      image: image(cms.heroImage)!,
      cta: cms.heroPrimaryLabel || undefined,
      target: hrefToTarget(cms.heroPrimaryHref, categories),
    },
    ...(cms.collectionsEnabled ? cms.collectionsList : [])
      .filter((collection) => collection.image)
      .map((collection) => ({
        id: `collection-${collection.id}`,
        title: collection.title,
        subtitle: cms.collectionsTitle || undefined,
        image: image(collection.image)!,
        cta: "Voir",
        target: hrefToTarget(collection.href, categories),
      })),
  ].filter(Boolean);

  const sections = [
    banners.length > 0 && { type: "banners", id: "hero", banners },
    cms.categoriesEnabled !== false && { type: "categories", id: "categories", title: cms.categoriesTitle || "Categories" },
    cms.flashEnabled && { type: "products", id: "flash", title: cms.flashTitle || "Ventes flash", collection: "deals", limit: 12, style: "flash" },
    cms.newArrivalsEnabled && {
      type: "products",
      id: "new",
      title: cms.newArrivalsTitle || "Nouveautes",
      collection: "new",
      limit: Math.min(24, Number.parseInt(cms.newArrivalsLimit, 10) || 12),
    },
    { type: "recently_viewed", id: "recent", title: "Recemment consultes" },
    { type: "products", id: "best", title: "Meilleures ventes", collection: "best", limit: 12 },
    { type: "recommended", id: "reco", title: "Recommande pour vous" },
  ].filter(Boolean);

  return {
    announcement: cms.announcement || null,
    trust: [cms.trustDelivery, cms.trustQuality, cms.trustPayment].filter(Boolean),
    sections,
  };
}
