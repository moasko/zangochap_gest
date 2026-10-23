// Types et catalogues PURS des notifications push de l'application mobile :
// importables cote client (console admin) comme cote serveur (moteur).
// Ne rien ajouter ici qui touche prisma, l'auth ou les variables d'environnement.

// Cible ouverte quand le client touche la notification (meme vocabulaire que l'app).
export type PushTarget =
  | { type: "home" }
  | { type: "collection"; key: string; title?: string }
  | { type: "category"; id: string; name?: string }
  | { type: "product"; id: string; name?: string }
  | { type: "order"; id: string }
  | { type: "url"; url: string };

// Sujets auxquels l'appareil est abonne (reglables dans l'app, ecran Notifications).
export type PushTopic = "orders" | "promotions" | "cartReminders";

export const TOPIC_LABELS: Record<PushTopic, string> = {
  orders: "Suivi de commande",
  promotions: "Offres et nouveautés",
  cartReminders: "Rappels de panier",
};

export type PushPlatform = "ios" | "android" | "web";

export type PushDevice = {
  id: string;
  token: string;
  platform: PushPlatform;
  appVersion: string | null;
  topics: Record<PushTopic, boolean>;
  // Numeros (format 225XXXXXXXXXX) des commandes passees depuis l'appareil : relie
  // l'appareil aux notifications de suivi de ces commandes.
  phones: string[];
  orderIds: string[];
  active: boolean;
  createdAt: string;
  lastSeenAt: string;
  disabledReason?: string | null;
};

// Audience d'une campagne. Les campagnes n'atteignent que les appareils abonnes
// aux offres (« promotions ») sauf pour une liste explicite de numeros.
export type PushAudience = {
  kind: "all" | "platform" | "phones" | "customers" | "inactive";
  platform?: PushPlatform;
  // kind = phones : numeros saisis par l'equipe.
  phones?: string[];
  // kind = customers : clients ayant commande dans les N derniers jours.
  orderedWithinDays?: number;
  // kind = inactive : appareils n'ayant pas ouvert l'app depuis N jours.
  inactiveDays?: number;
};

export type PushCampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";

export type PushCampaign = {
  id: string;
  title: string;
  body: string;
  image: string | null;
  target: PushTarget;
  audience: PushAudience;
  status: PushCampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  createdBy: string | null;
  stats: { targeted: number; sent: number; failed: number; opened: number };
  error: string | null;
};

// Notifications automatiques de suivi de commande, une par statut.
export type OrderStatusTemplate = { enabled: boolean; title: string; body: string };

export type PushSettings = {
  enabled: boolean;
  // Notifications de suivi de commande automatiques, par statut.
  orderStatus: Record<string, OrderStatusTemplate>;
  // Campagnes marketing : plage horaire (heure d'Abidjan) hors de laquelle les
  // envois programmes attendent l'ouverture suivante.
  quietHoursEnabled: boolean;
  sendStart: string;
  sendEnd: string;
  // Plafond de campagnes marketing par appareil et par jour (0 = illimite).
  dailyLimitPerDevice: number;
};

// Statuts proposes pour le suivi automatique (les statuts internes restent muets).
export const ORDER_PUSH_STATUSES = [
  "CONFIRMED",
  "PREPARING",
  "PACKED",
  "ON_DELIVERY",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "REPROGRAMMED",
  "CANCELLED",
] as const;

export const DEFAULT_ORDER_TEMPLATES: Record<string, OrderStatusTemplate> = {
  CONFIRMED: { enabled: true, title: "Commande confirmée ✅", body: "Votre commande {reference} est confirmée. Nous la préparons." },
  PREPARING: { enabled: false, title: "Commande en préparation", body: "Votre commande {reference} est en cours de préparation." },
  PACKED: { enabled: true, title: "Commande prête 📦", body: "Votre commande {reference} est emballée et part bientôt." },
  ON_DELIVERY: { enabled: true, title: "En route ! 🛵", body: "Votre commande {reference} est en livraison. Gardez votre téléphone à portée de main." },
  DELIVERED: { enabled: true, title: "Commande livrée 🎉", body: "Merci pour votre confiance ! Votre commande {reference} a été livrée." },
  PARTIALLY_DELIVERED: { enabled: true, title: "Livraison partielle", body: "Une partie de votre commande {reference} a été livrée. Notre équipe vous recontacte." },
  REPROGRAMMED: { enabled: true, title: "Livraison reprogrammée", body: "La livraison de votre commande {reference} a été reprogrammée." },
  CANCELLED: { enabled: true, title: "Commande annulée", body: "Votre commande {reference} a été annulée. Contactez-nous pour toute question." },
};

export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  enabled: true,
  orderStatus: DEFAULT_ORDER_TEMPLATES,
  quietHoursEnabled: true,
  sendStart: "08:00",
  sendEnd: "21:00",
  dailyLimitPerDevice: 2,
};

// Variables des modeles de suivi de commande.
export const ORDER_PUSH_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "{reference}", label: "Référence de la commande" },
  { key: "{client}", label: "Prénom du client" },
  { key: "{montant}", label: "Montant total" },
  { key: "{statut}", label: "Nouveau statut" },
];

// Collections de l'app proposees comme cible.
export const PUSH_COLLECTIONS: Array<{ key: string; title: string }> = [
  { key: "new", title: "Nouveautés" },
  { key: "deals", title: "Promotions" },
  { key: "best", title: "Meilleures ventes" },
  { key: "popular", title: "Populaires" },
];

export type PushLogEntry = {
  at: string;
  kind: "campaign" | "order" | "test";
  label: string;
  sent: number;
  failed: number;
  error: string | null;
};

export const TITLE_MAX = 65;
export const BODY_MAX = 240;

export function describeAudience(audience: PushAudience): string {
  switch (audience.kind) {
    case "all":
      return "Tous les abonnés aux offres";
    case "platform":
      return `Abonnés ${audience.platform === "ios" ? "iPhone" : audience.platform === "android" ? "Android" : "web"}`;
    case "phones":
      return `${audience.phones?.length ?? 0} numéro(s) ciblé(s)`;
    case "customers":
      return `Clients ayant commandé depuis ${audience.orderedWithinDays ?? 30} j`;
    case "inactive":
      return `Inactifs depuis ${audience.inactiveDays ?? 14} j`;
  }
}

export function describeTarget(target: PushTarget): string {
  switch (target.type) {
    case "home":
      return "Accueil";
    case "collection":
      return `Collection « ${target.title || target.key} »`;
    case "category":
      return `Rayon « ${target.name || target.id} »`;
    case "product":
      return `Produit « ${target.name || target.id} »`;
    case "order":
      return "Suivi de commande";
    case "url":
      return target.url;
  }
}
