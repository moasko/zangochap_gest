// Communes Abidjan → préfixes commande
export const COMMUNES: Record<string, string> = {
  'Cocody': 'CD',
  'Port-Bouët': 'PB',
  'Marcory': 'MA',
  'Koumassi': 'KM',
  'Attécoubé': 'AT',
  'Plateau': 'PL',
  'Adjamé': 'AD',
  'Yopougon': 'YP',
  'Abobo': 'AB',
  'Treichville': 'TV',
  'Anyama': 'AN',
  'Bingerville': 'BV',
  'Bassam': 'BA',
  'Songon': 'YP',
  'Abidjan BJ': 'BJ',
  'Boutique': 'BT',
  'Hors Abidjan': 'EXP',
};

// Tarifs de livraison standards par commune
export const DELIVERY_FEES: Record<string, number> = {
  'Cocody': 1500,
  'Port-Bouët': 1500,
  'Marcory': 1500,
  'Koumassi': 1500,
  'Attécoubé': 1500,
  'Plateau': 1500,
  'Adjamé': 1500,
  'Yopougon': 1500,
  'Abobo': 1500,
  'Treichville': 1500,
  'Anyama': 2000,
  'Bingerville': 2000,
  'Bassam': 2000,
  'Songon': 2000,
  'Abidjan BJ': 1500,
  'Hors Abidjan': 2500,
};

export const ROLE_LABELS: Record<string, string> = {
  comptable: 'Comptable',
  developer: 'Développeur',
  commercial: 'Commercial',
  packing: 'Service emballage',
  collection: 'Service collecte',
  stock: 'Gestion de stock',
  point_relais: 'Gérant point relais',
  admin: 'Administrateur',
  livreur: 'Livreur',
};

export const STATUS_LABELS: Record<string, string> = {
  TO_PROCESS: 'À traiter',
  PENDING: 'En attente',
  CONFIRMED: 'Confirmée',
  PACKED: 'Emballée',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livrée',
  CANCELLED: 'Annulée',
  COLLECTED: 'Collecté',
  UNAVAILABLE: 'Indisponible',
  ALTERNATIVE: 'Alternative',
  SENT: 'Envoyé',
  ON_DELIVERY: 'En livraison',
  REPROGRAMMED: 'Reprogrammée',
  REPRO_DISPO: 'Repro-dispo',
  PREPARING: 'En préparation',
};

// Lowercase versions for CSS classes
export const STATUS_CSS: Record<string, string> = {
  TO_PROCESS: 'to_process',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PACKED: 'packed',
  PARTIAL: 'partial',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  COLLECTED: 'collected',
  UNAVAILABLE: 'unavailable',
  ALTERNATIVE: 'alternative',
  SENT: 'sent',
  ON_DELIVERY: 'on_delivery',
  REPROGRAMMED: 'reprogrammed',
  REPRO_DISPO: 'repro_dispo',
  PREPARING: 'preparing',
};

export const CATEGORIES: Record<string, string> = {
  shoes: 'Chaussures',
  clothes: 'Vêtements',
  watches: 'Montres',
  bracelets: 'Bracelets',
  accessories: 'Accessoires',
  kids: 'Enfants',
};

export function formatPrice(n: number | string | null | undefined): string {
  const val = typeof n === 'number' ? n : Number(n ?? 0);
  return new Intl.NumberFormat('fr-FR').format(Number.isFinite(val) ? val : 0) + ' F';
}

// Libelles francais des actions d'audit comptable (sinon on affiche le code brut).
const ACCOUNTING_ACTION_LABELS: Record<string, string> = {
  OPERATION_CREATED: 'Ecriture creee',
  OPERATION_UPDATED: 'Ecriture modifiee',
  OPERATION_DELETED: 'Ecriture supprimee',
  RIDER_ENTRY_VALIDATED: 'Entree livreur validee',
  RIDER_ENTRY_VALIDATED_UPDATED: 'Entree livreur mise a jour',
  RIDER_ENTRY_CANCELLED: 'Validation livreur annulee',
  LEGACY_DELIVERY_ENTRY_NEUTRALIZED: 'Entree livraison neutralisee',
  SESSION_CLOSED: 'Session cloturee',
  SESSION_REOPENED: 'Session rouverte',
  CATEGORY_CREATED: 'Categorie creee',
  CATEGORY_UPDATED: 'Categorie modifiee',
  CATEGORY_DELETED: 'Categorie supprimee',
  REPORT_CREATED: 'Bilan enregistre',
};

export function accountingActionLabel(action: string): string {
  return ACCOUNTING_ACTION_LABELS[action] || action;
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDay(d: string | Date): string {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
