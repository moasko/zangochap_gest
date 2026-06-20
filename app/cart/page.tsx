import React from "react";
import type { Metadata } from "next";
import PublicLayout from "@/components/public/PublicLayout";
import CartPageClient from "./cart-page-client";
import { getCommunes } from "@/modules/settings/actions";
import { SITE_NAME, SITE_URL, SITE_LOCALE, DEFAULT_OG_IMAGE } from "@/lib/seo";
import { getActiveRelayPoints } from "@/modules/boutique/relay-queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Panier — ${SITE_NAME}`,
  description: `Votre panier d'achat sur ${SITE_NAME}. Finalisez votre commande et profitez de la livraison rapide à Abidjan.`,
  robots: { index: false, follow: true },
  alternates: { canonical: "/cart" },
  openGraph: {
    type: "website",
    locale: SITE_LOCALE,
    url: `${SITE_URL}/cart`,
    siteName: SITE_NAME,
    title: `Panier — ${SITE_NAME}`,
    description: `Finalisez votre commande sur ${SITE_NAME}.`,
    images: [{ url: DEFAULT_OG_IMAGE }],
  },
};

export default async function CartPage() {
  const [communes, relayPoints] = await Promise.all([
    getCommunes(),
    getActiveRelayPoints(),
  ]);
  
  return (
    <PublicLayout>
      <CartPageClient communes={JSON.parse(JSON.stringify(communes))} relayPoints={relayPoints} />
    </PublicLayout>
  );
}
