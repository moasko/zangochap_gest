import { notFound } from "next/navigation";
import PushClient from "@/app/zangochap-manager/admin/push/PushClient";
import { DEFAULT_PUSH_SETTINGS, type PushCampaign } from "@/modules/push/types";

export const dynamic = "force-dynamic";

// Apercu local de la console push : donnees fictives, actions refusees (aucune session staff).
export default function PushPreview() {
  if (process.env.NODE_ENV !== "development" || process.env.PUSH_PREVIEW !== "1") notFound();
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();
  const campaigns: PushCampaign[] = [
    { id: "c1", title: "Vente flash -30 % ce soir 🔥", body: "Sneakers, sacs et montres jusqu'à minuit seulement.", image: null, target: { type: "collection", key: "deals", title: "Promotions" }, audience: { kind: "all" }, status: "scheduled", scheduledAt: iso(180), sentAt: null, createdAt: iso(-30), createdBy: "Admin", stats: { targeted: 0, sent: 0, failed: 0, opened: 0 }, error: null },
    { id: "c2", title: "Nouveautés : la collection d'octobre est là", body: "Découvrez nos nouvelles chemises et pantalons cargo.", image: null, target: { type: "collection", key: "new", title: "Nouveautés" }, audience: { kind: "customers", orderedWithinDays: 60 }, status: "sent", scheduledAt: null, sentAt: iso(-1440), createdAt: iso(-1500), createdBy: "Admin", stats: { targeted: 412, sent: 405, failed: 7, opened: 96 }, error: null },
    { id: "c3", title: "Votre panier vous attend", body: "Profitez de la livraison offerte à Abidjan.", image: null, target: { type: "home" }, audience: { kind: "inactive", inactiveDays: 14 }, status: "draft", scheduledAt: null, sentAt: null, createdAt: iso(-10), createdBy: "Admin", stats: { targeted: 0, sent: 0, failed: 0, opened: 0 }, error: null },
  ];
  return (
    <PushClient
      initialData={{
        settings: DEFAULT_PUSH_SETTINGS,
        campaigns,
        log: [
          { at: iso(-5), kind: "order", label: "AB23025 → En livraison", sent: 1, failed: 0, error: null },
          { at: iso(-1440), kind: "campaign", label: "Nouveautés : la collection d'octobre est là", sent: 405, failed: 7, error: null },
        ],
        overview: {
          total: 640, active: 598, ios: 121, android: 477, promotions: 431, orders: 590, linked: 512, activeThisWeek: 344,
          recent: [{ id: "d1", platform: "android", appVersion: "1.0.0", active: true, topics: { orders: true, promotions: true, cartReminders: false }, phones: ["22507•••00"], lastSeenAt: iso(-3), disabledReason: null }],
        },
        categories: [{ id: "cat1", name: "Chaussures" }, { id: "cat2", name: "Vêtements homme" }],
        expoTokenConfigured: false,
      }}
    />
  );
}
