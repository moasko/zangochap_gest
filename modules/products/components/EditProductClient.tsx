"use client";

import React, { useTransition } from "react";
import { useToast } from "@/components/Toast";
import { updateProduct } from "@/modules/products/actions";
import { useRouter } from "next/navigation";
import ProductForm from "@/modules/products/components/ProductForm";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";

export default function EditProductClient({ product, warehouses, categories, suppliers = [], commercials = [], user, giftMode = false }: { product: any, warehouses: any[], categories: any[], suppliers?: any[], commercials?: any[], user?: any, giftMode?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const handleSubmit = async (formData: any) => {
    startTransition(async () => {
      try {
        await updateProduct(product.id, formData);
        showToast("Produit mis à jour avec succès ✓", "success");
        router.push(giftMode ? "/zangochap-manager/admin/settings/gifts" : "/zangochap-manager/products");
      } catch (err: any) {
        if (reloadOnStaleServerAction(err)) return;
        showToast(err.message || "Erreur lors de la mise à jour", "error");
      }
    });
  };

  return (
    <ProductForm 
      title={`Modifier · ${product.name}`}
      initialData={product}
      warehouses={warehouses}
      categories={categories}
      suppliers={suppliers}
      commercials={commercials}
      user={user}
      onSubmit={handleSubmit}
      onCancel={() => giftMode ? router.push("/zangochap-manager/admin/settings/gifts") : router.back()}
      isPending={isPending}
    />
  );
}
