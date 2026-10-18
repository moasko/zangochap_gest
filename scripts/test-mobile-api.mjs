// Tests isoles de l'API mobile (/api/mobile/v1) : logique pure, Prisma simule. Aucune base, aucun reseau.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function load(path, modules = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const scope = { exports: {}, console, Date, Map, Set, Math, JSON, Number, String, Array, Object, Error, Promise, URLSearchParams };
  scope.module = { exports: scope.exports };
  scope.require = (name) => {
    if (name in modules) return modules[name];
    if (name.startsWith("@/") || name.startsWith(".")) throw new Error(`module non simule : ${name}`);
    return require(name);
  };
  vm.runInNewContext(compiled, scope, { filename: path });
  return scope.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

const text = load("modules/mobile-api/text.ts");
const constants = load("lib/constants.ts");
const dispatch = load("modules/orders/helpers/delivery-dispatch.ts", { "@/lib/constants": constants });
const fakePrisma = {};
const catalog = load("modules/mobile-api/catalog.ts", {
  "@/lib/prisma": { default: fakePrisma },
  "@/lib/seo": { getAbsoluteUrl: (url) => (url.startsWith("http") ? url : `https://zangochap.com${url}`) },
  "./text": text,
});
const delivery = load("modules/mobile-api/delivery.ts", {
  "@/lib/prisma": { default: fakePrisma },
  "@/modules/orders/helpers/delivery-dispatch": dispatch,
  "@/modules/boutique/relay-queries": { getActiveRelayPoints: async () => [] },
});
const home = load("modules/mobile-api/home.ts", {
  "@/lib/seo": { getAbsoluteUrl: (url) => url },
  "@/modules/cms/actions": {},
  "./catalog": catalog,
});

// ---------- Texte ----------
assert.equal(text.normalizeText("Pantalon Jeans LÉE !"), "pantalon jeans lee");
assert.ok(text.fuzzyScore("jeens", "pantalon jeans lee") > 0, "une faute de frappe est toleree");
assert.ok(text.fuzzyScore("sandale", "sandale clarks tb47") > text.fuzzyScore("sandale", "sandle babouche"), "prefixe exact mieux classe qu une faute");
assert.equal(text.fuzzyScore("montre", "pantalon jeans lee"), 0);
assert.equal(text.fuzzyScore("ab", "abc"), 3, "prefixe court accepte");
const sizes = ["XL", "40", "S", "Standard", "3XL", "M", "XXL", "42", "L"];
assert.deepEqual(plain([...sizes].sort(text.compareSizes)), ["S", "M", "L", "XL", "XXL", "3XL", "40", "42", "Standard"]);

// ---------- Catalogue ----------
const now = Date.now();
const entry = (id, extra = {}) => ({
  id, slug: id, name: id, ref: null, price: 10000, oldPrice: null, image: null, categoryId: "c1", categoryName: "Vetements",
  stock: 5, soldCount: 0, isFeatured: false, createdAt: new Date(now - 86_400_000).toISOString(), searchText: id, ...extra,
});
const entries = [
  entry("jean-lee", { searchText: "pantalon jeans lee", soldCount: 40, price: 6500 }),
  entry("jacket", { searchText: "complet jacket noir", soldCount: 117, price: 16900, oldPrice: 25000 }),
  entry("sandale", { searchText: "sandale clarks", categoryId: "c2", soldCount: 92, price: 6900, oldPrice: 12000 }),
  entry("rupture", { searchText: "jeans rupture", stock: 0, soldCount: 500 }),
  entry("vedette", { searchText: "ensemble vedette", isFeatured: true, soldCount: 1 }),
  entry("recent", { searchText: "nouveau polo", createdAt: new Date(now).toISOString() }),
];
const ids = (result) => result.items.map((item) => item.id);

// Populaire : mis en avant puis ventes ; ruptures toujours a la fin.
assert.deepEqual(plain(ids(catalog.queryCatalog(entries, {}))), ["vedette", "jacket", "sandale", "jean-lee", "recent", "rupture"]);
// Recherche tolerante, pertinence d'abord.
assert.deepEqual(plain(ids(catalog.queryCatalog(entries, { q: "jeens" }))), ["jean-lee", "rupture"]);
// Offres : uniquement les prix barres, classees par ventes.
assert.deepEqual(plain(ids(catalog.queryCatalog(entries, { collection: "deals" }))), ["jacket", "sandale"]);
// Nouveautes : plus recent d'abord.
assert.equal(catalog.queryCatalog(entries, { collection: "new" }).items[0].id, "recent");
// Filtres combines + disponibilite + prix.
assert.deepEqual(plain(ids(catalog.queryCatalog(entries, { categoryId: "c1", inStock: true, maxPrice: 10000, sort: "price_asc" }))), ["jean-lee", "recent", "vedette"], "a prix egal, le plus recent d abord");
// Pagination bornee.
const page = catalog.queryCatalog(entries, { pageSize: 2, page: 2 });
assert.equal(page.items.length, 2);
assert.equal(page.total, 6);
assert.equal(page.hasMore, true);
assert.equal(catalog.queryCatalog(entries, { pageSize: 500 }).pageSize, 50, "taille de page plafonnee");
// Un oldPrice inferieur ou egal au prix n'est pas une promo.
assert.equal(catalog.toSummary(entry("x", { oldPrice: 9000 })).oldPrice, null);
assert.equal(catalog.sellableStock({ stock: 99, variants: [{ stock: 2 }, { stock: -1 }, { stock: 3 }] }), 5);
assert.equal(catalog.sellableStock({ stock: 4, variants: [] }), 4);
assert.equal(catalog.absoluteImage("/images/a.png;/images/b.png"), "https://zangochap.com/images/a.png");
assert.equal(catalog.mainImage({ mainImageId: "i2", images: [{ id: "i1", url: "https://r2/a.jpg", position: 0 }, { id: "i2", url: "https://r2/b.jpg", position: 1 }] }), "https://r2/b.jpg");

// ---------- Livraison : doublons de la table Commune ----------
const zones = delivery.buildZones([
  { name: "yopougon", deliveryFee: 1500 },
  { name: "Yopougon", deliveryFee: 1500 },
  { name: "BOUAKE", deliveryFee: 2500 },
  { name: "Bouaké", deliveryFee: 0 },
  { name: "BOUTIQUE", deliveryFee: 0 },
  { name: "Port bouet", deliveryFee: 1500 },
  { name: "Hors Abidjan", deliveryFee: 2500 },
]);
assert.deepEqual(plain(zones.map((z) => [z.commune, z.fee, z.kind])), [
  ["Port-Bouët", 1500, "abidjan"],
  ["Yopougon", 1500, "abidjan"],
  ["Bouake", 2500, "outside"],
  ["Hors Abidjan", 2500, "outside"],
  ["Boutique", 0, "pickup"],
]);

// ---------- Liens du CMS ----------
const cats = [{ id: "cat-ch", name: "Chaussures" }, { id: "cat-acc", name: "ACCESSOIRE" }, { id: "cat-vh", name: "Vêtements homme" }];
assert.deepEqual(plain(home.hrefToTarget("/shop?category=Chaussures", cats)), { type: "category", id: "cat-ch" });
assert.deepEqual(plain(home.hrefToTarget("/shop?category=Accessoires", cats)), { type: "category", id: "cat-acc" }, "pluriel / casse tolere");
assert.deepEqual(plain(home.hrefToTarget("/shop?category=Vetements", cats)), { type: "category", id: "cat-vh" }, "debut de nom, sans accents");
assert.deepEqual(plain(home.hrefToTarget("/product/abc", cats)), { type: "product", id: "abc" });
assert.deepEqual(plain(home.hrefToTarget("https://wa.me/225", cats)), { type: "url", url: "https://wa.me/225" });
assert.equal(home.hrefToTarget("/shop", cats).type, "collection");

console.log("PASS: API mobile (texte, tailles, catalogue, filtres/tris, communes dedoublonnees, liens CMS).");
