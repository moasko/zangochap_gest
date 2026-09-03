import Topbar from "@/components/Topbar";
import { getGiftQuotaAdminData } from "@/modules/gifts/actions";
import GiftQuotaClient from "./GiftQuotaClient";
import { getSession } from "@/modules/auth/actions";

export const dynamic = "force-dynamic";

export default async function GiftQuotaPage() {
  const user = await getSession();
  if (!user || !["admin", "developer"].includes(user.role.toLowerCase())) {
    return <div className="content"><div className="empty"><h4>Accès refusé</h4><p>Cette page est réservée aux administrateurs et développeurs.</p></div></div>;
  }

  try {
    const data = await getGiftQuotaAdminData();
    return <><Topbar title="Configuration" subtitle="gestion des cadeaux" /><GiftQuotaClient initialData={data} /></>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return <>
      <Topbar title="Configuration" subtitle="gestion des cadeaux" />
      <div className="content">
        <div className="empty" style={{ maxWidth: 680, margin: "40px auto" }}>
          <h4>Impossible de charger les cadeaux</h4>
          <p>Le chargement des cadeaux a échoué. Réessayez dans quelques instants.</p>
          <p className="cell-muted">Si les tables des quotas sont manquantes, appliquez après sauvegarde le script <code>prisma/manual-migrations/20260828_add_gift_quotas.sql</code>, puis actualisez cette page.</p>
          <details style={{ marginTop: 12, textAlign: "left" }}><summary>Détail technique</summary><pre style={{ whiteSpace: "pre-wrap" }}>{message}</pre></details>
        </div>
      </div>
    </>;
  }
}
