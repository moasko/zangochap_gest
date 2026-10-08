import { notFound } from "next/navigation";
import DeliveryDemo from "./DeliveryDemo";
import PlanningDemo from "./PlanningDemo";
import "@/app/zangochap-manager/manager-layout.css";

// Apercu local de l'ecran Livraisons et du Planning avec donnees fictives (aucune base,
// aucune session ; actions simulees en memoire, repartition par le vrai moteur).
// Actif uniquement en developpement avec DELIVERY_PREVIEW=1. ?view=planning pour le Planning,
// ?clean=1 pour masquer le bandeau (enregistrement video).
export const dynamic = "force-dynamic";

export default async function DeliveryPreview({ searchParams }: { searchParams: Promise<{ view?: string; clean?: string }> }) {
  const { view, clean } = await searchParams;
  if (process.env.NODE_ENV !== "development" || process.env.DELIVERY_PREVIEW !== "1") notFound();

  return (
    <>
      {clean !== "1" && (
        <p style={{ padding: 12, margin: 0, background: "#fff3cd", fontSize: 13 }}>
          Apercu local — donnees fictives, actions simulees (aucune base, aucune session).
        </p>
      )}
      {view === "planning" ? <PlanningDemo /> : <DeliveryDemo />}
    </>
  );
}
