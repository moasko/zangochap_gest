import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getDepositAdminData } from "@/modules/expedition-deposits/actions";
import DepositVerificationClient from "./DepositVerificationClient";

export const dynamic = "force-dynamic";

export default async function DepositVerificationPage() {
  const user = await getSession();
  if (!user || !["ADMIN", "DEVELOPER"].includes(String(user.role).toUpperCase())) {
    return <div className="content"><div className="empty"><h4>Accès refusé</h4><p>Cette page est réservée aux administrateurs.</p></div></div>;
  }
  try {
    const orders = await getDepositAdminData();
    return <><Topbar title="Alertes expédition" subtitle="validation des dépôts hors Abidjan" /><DepositVerificationClient initialOrders={JSON.parse(JSON.stringify(orders))} /></>;
  } catch (error) {
    return <><Topbar title="Alertes expédition" subtitle="validation des dépôts hors Abidjan" /><div className="content"><div className="empty"><h4>Configuration de la base requise</h4><p>Appliquez après sauvegarde le script <code>prisma/manual-migrations/20260828_add_expedition_deposit_verification.sql</code>.</p><small>{error instanceof Error ? error.message : "Erreur inconnue"}</small></div></div></>;
  }
}
