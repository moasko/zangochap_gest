import { getProductDetail } from "@/modules/mobile-api/catalog";
import { MobileApiError } from "@/modules/mobile-api/errors";
import { handle, json, preflight } from "@/modules/mobile-api/http";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const product = await getProductDetail(decodeURIComponent(id));
    if (!product) throw new MobileApiError("Produit introuvable.", 404, "NOT_FOUND");
    return json(product, { cache: 30 });
  });
}
