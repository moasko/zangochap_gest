// Helpers PURS (sans dependance serveur) : importables cote client (apercu dans
// les modals) comme cote serveur (envoi API). Ne rien ajouter ici qui touche
// prisma, l'auth ou les variables d'environnement.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Normalise un numero ivoirien au format international attendu par l'API Cloud
// (ex. "07 00 00 00 00" -> "2250700000000").
export function normalizeIvorianPhone(value: string) {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `225${phone.slice(1)}`;
  else if (!phone.startsWith("225") && phone.length === 10) phone = `225${phone}`;
  return phone;
}

function fmtPrice(value: number) {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0))} FCFA`;
}

// Variables utilisables dans les modeles de messages (commande + marketing).
export const ORDER_TEMPLATE_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "{client}", label: "Nom complet du client" },
  { key: "{nom}", label: "Nom (1er mot)" },
  { key: "{prenom}", label: "Prénom(s)" },
  { key: "{telephone}", label: "Téléphone 1" },
  { key: "{telephone2}", label: "Téléphone 2" },
  { key: "{ref}", label: "Référence commande" },
  { key: "{lieu}", label: "Lieu de livraison" },
  { key: "{commune}", label: "Commune" },
  { key: "{produits}", label: "Liste des produits" },
  { key: "{sous_total}", label: "Sous-total" },
  { key: "{livraison}", label: "Frais de livraison" },
  { key: "{remise}", label: "Remise" },
  { key: "{total}", label: "Prix total" },
  { key: "{date_livraison}", label: "Date de livraison" },
];

// Variables disponibles pour une diffusion marketing (sans commande associee).
export const CUSTOMER_TEMPLATE_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "{client}", label: "Nom complet du client" },
  { key: "{nom}", label: "Nom (1er mot)" },
  { key: "{prenom}", label: "Prénom(s)" },
  { key: "{telephone}", label: "Téléphone" },
];

// Message de confirmation par defaut (personnalisable dans l'onglet Marketing
// de la console admin WhatsApp).
export const DEFAULT_ORDER_TEMPLATE = `🎉 *Votre commande est validée !*

Veuillez vérifier vos informations enregistrées pour la commande

Nom: {nom}
Prenom: {prenom}
Numéro joignable 1: {telephone}
Numéro joignable 2 : {telephone2}
Lieu de livraison : {lieu} ({commune})

{produits}

Prix total: {total}

📲 Téléchargez l'application dès maintenant en cliquant ici 👇 :

🤖 *Android* : https://play.google.com/store/apps/details?id=com.zangochap.zangochap&pcampaignid=web_share

🍏 *iPhone* : https://apps.apple.com/ci/app/zangochap/id6737241287

🎁 Envoyez-nous une capture d'écran de l'application installée pour activer votre surprise.

Ne passez pas à côté de cette belle surprise ! 😍🔥`;

export function renderTemplate(template: string, variables: Record<string, string>) {
  return Object.entries(variables)
    .reduce((text, [key, value]) => text.split(key).join(value), String(template || ""))
    .trim();
}

function splitName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return { lastName: parts[0] || "—", firstName: parts.slice(1).join(" ") || "—" };
}

export function customerTemplateVariables(customer: { name?: string | null; phone?: string | null }) {
  const { lastName, firstName } = splitName(customer?.name || "");
  return {
    "{client}": customer?.name || "—",
    "{nom}": lastName,
    "{prenom}": firstName,
    "{telephone}": customer?.phone || "—",
  };
}

export function orderTemplateVariables(order: any): Record<string, string> {
  const items = Array.isArray(order?.items) ? order.items : [];
  const subtotal = Number(order?.total || 0);
  const deliveryFee = Number(order?.deliveryFee || 0);
  const discount = Number(order?.discount || 0);
  const total = Math.max(0, subtotal + deliveryFee - discount);
  const { lastName, firstName } = splitName(order?.customerName || "");

  const productLines = items.map((item: any) => {
    const variant = [item.size, item.color]
      .filter((part: string) => part && part !== "Standard")
      .join("/");
    return `Nom du produit : ${item.name}${variant ? ` (${variant})` : ""} x${Number(item.qty || 1)}`;
  }).join("\n");

  const deliveryDate = order?.deliveryDate ? new Date(order.deliveryDate) : null;
  const dateLabel = deliveryDate && !Number.isNaN(deliveryDate.getTime())
    ? deliveryDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    : "—";

  return {
    "{client}": order?.customerName || "—",
    "{nom}": lastName,
    "{prenom}": firstName,
    "{telephone}": order?.customerPhone || "—",
    "{telephone2}": order?.customerPhone2 || "—",
    "{ref}": order?.ref || "—",
    "{lieu}": order?.customerLocation || "—",
    "{commune}": order?.commune || "—",
    "{produits}": productLines || "—",
    "{sous_total}": fmtPrice(subtotal),
    "{livraison}": fmtPrice(deliveryFee),
    "{remise}": discount > 0 ? fmtPrice(discount) : "0 FCFA",
    "{total}": fmtPrice(total),
    "{date_livraison}": dateLabel,
  };
}

// Message de confirmation d'une commande : modele personnalise s'il est
// configure, sinon le modele par defaut ci-dessus.
export function buildOrderWhatsAppMessage(order: any, template?: string | null): string {
  const source = template?.trim() || DEFAULT_ORDER_TEMPLATE;
  return renderTemplate(source, orderTemplateVariables(order));
}

// Exemple de commande pour previsualiser un modele dans la console admin.
export const SAMPLE_ORDER = {
  ref: "ZC-1234",
  customerName: "Zangosave Awa",
  customerPhone: "0574641453",
  customerPhone2: "",
  customerLocation: "Abidjan",
  commune: "Marcory",
  total: 9000,
  deliveryFee: 400,
  discount: 0,
  deliveryDate: null,
  items: [
    { name: "Ceinture boucle simple", size: "Standard", color: "Standard", qty: 1, price: 9000 },
  ],
};
