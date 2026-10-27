// Secret de signature des sessions staff (cookie zc_session) et des jetons de
// l'application livreur. Module serveur prive : ne JAMAIS l'importer depuis un
// composant client ni l'exporter depuis un fichier "use server".

// Le secret ne doit JAMAIS retomber sur une valeur connue : l'ancien fallback etait
// present dans le repo, donc n'importe qui pouvait forger un cookie de session admin.
// On accepte tout secret defini par l'exploitant ; on refuse seulement l'absence de
// secret ou l'ancienne valeur fuitee.
const LEAKED_DEFAULT_SECRET = "zangochap-super-secret-key-change-me-in-prod";

/** Audience obligatoire des jetons de l'application livreur (en-tete Authorization). */
export const RIDER_APP_AUDIENCE = "zangochap-rider-app";

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret !== LEAKED_DEFAULT_SECRET) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET manquant ou egal a l'ancienne valeur par defaut compromise. Definissez un secret unique avant de demarrer en production.",
    );
  }
  console.warn("[auth] JWT_SECRET absent : secret de developpement ephemere utilise. Ne pas utiliser en production.");
  return "dev-only-insecure-secret-do-not-use-in-production";
}

// Resolution paresseuse : `next build` importe ce module (NODE_ENV=production)
// sans disposer des secrets d'exploitation. La verification ne s'execute qu'au
// premier usage reel (login / lecture de session), pas a l'import.
let cachedJwtSecret: Uint8Array | null = null;

export function getJwtSecret() {
  if (!cachedJwtSecret) cachedJwtSecret = new TextEncoder().encode(resolveJwtSecret());
  return cachedJwtSecret;
}
