import type { NextRequest } from "next/server";

import { getCatalog, queryCatalog, type ProductSort } from "@/modules/mobile-api/catalog";
import { handle, intParam, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const SORTS: ProductSort[] = ["relevance", "popular", "newest", "price_asc", "price_desc", "rating"];

export function GET(request: NextRequest) {
  return handle(async () => {
    const p = request.nextUrl.searchParams;
    const sort = p.get("sort") as ProductSort | null;
    const result = queryCatalog(await getCatalog(), {
      q: p.get("q")?.slice(0, 80) || undefined,
      categoryId: p.get("categoryId") || undefined,
      minPrice: intParam(p.get("minPrice")),
      maxPrice: intParam(p.get("maxPrice")),
      inStock: p.get("inStock") === "true",
      sort: sort && SORTS.includes(sort) ? sort : undefined,
      collection: p.get("collection") || undefined,
      ids: p.get("ids")?.split(",").filter(Boolean).slice(0, 100),
      excludeId: p.get("excludeId") || undefined,
      page: intParam(p.get("page")),
      pageSize: intParam(p.get("pageSize")),
    });
    return json(result, { cache: 30 });
  });
}
