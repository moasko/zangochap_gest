import { randomUUID } from "node:crypto";

export function exchangeTechnicalMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  switch (code) {
    case "P2002": return "Une donnée unique existe déjà (par exemple la référence de commande). Actualisez les demandes avant de réessayer.";
    case "P2003": return "Une donnée liée à la commande n’existe plus ou n’est plus valide. Vérifiez les articles et les comptes associés avant de refaire la demande.";
    case "P2025": return "Une donnée nécessaire a été supprimée ou modifiée pendant le traitement. Actualisez la demande.";
    case "P1001": case "P1002": case "P1008": case "P1017": case "P2024":
      return "La base de données est indisponible ou ne répond pas à temps. Actualisez pour vérifier le statut avant de réessayer dans quelques instants.";
    case "P2028": return "La transaction n’a pas pu aboutir (expiration ou fermeture). Actualisez pour vérifier le statut avant de réessayer.";
    case "P2034": return "Une autre opération a modifié les mêmes données simultanément. Actualisez puis réessayez.";
    case "P2021": case "P2022": return "La structure de la base ne correspond pas à l’application déployée. Contactez le responsable technique avec cette référence.";
    default: return "Une erreur interne inattendue empêche le traitement. Contactez le responsable technique avec cette référence.";
  }
}

export function logExchangeFailure(stage: string, error: unknown) {
  const reference = randomUUID();
  const code = typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : undefined;
  // Neither exception messages/stacks nor request payloads belong in this log.
  console.error("[exchange]", { reference, stage, code });
  return reference;
}
