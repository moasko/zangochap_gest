"use client";

import React, { useTransition } from "react";
import { useToast } from "@/components/Toast";
import { createProduct } from "@/modules/products/actions";
import { useRouter } from "next/navigation";
import ProductForm from "@/modules/products/components/ProductForm";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";

export default function NewProductClient({ warehouses, categories, suppliers = [], commercials = [], user, giftMode = false }: { warehouses: any[], categories: any[], suppliers?: any[], commercials?: any[], user?: any, giftMode?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const handleSubmit = async (formData: any) => {
    startTransition(async () => {
      try {
        await createProduct(formData);
        showToast("Produit ajouté avec succès ✓", "success");
        router.push(giftMode ? "/zangochap-manager/admin/settings/gifts" : "/zangochap-manager/products");
      } catch (err: any) {
        if (reloadOnStaleServerAction(err)) return;
        showToast(err.message || "Erreur lors de l'ajout", "error");
      }
    });
  };

  return (
    <ProductForm 
      title={giftMode ? "Nouveau cadeau" : "Nouveau produit"}
      defaultIsGift={giftMode}
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
