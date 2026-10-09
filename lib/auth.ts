import { getSession } from "@/modules/auth/actions";

/**
 * Helper to ensure the user is authenticated and has one of the required roles.
 * @param roles Array of allowed roles (e.g., ["admin", "stock"])
 * @returns The session payload if authorized
 * @throws Error if not authenticated or not authorized
 */
export async function ensureAuth(roles?: string[]) {
  const session = await getSession();
  
  if (!session) {
    throw new Error("Non authentifié. Veuillez vous connecter.");
  }

  if (roles && !roles.includes(session.role.toLowerCase()) && session.role.toLowerCase() !== 'developer') {
    // Diagnostic sans donnee personnelle : role refuse, roles attendus et page d'origine,
    // pour identifier en production quel ecran appelle une action interdite a ce role.
    let page = "?";
    try {
      const { headers } = await import("next/headers");
      const referer = (await headers()).get("referer");
      page = referer ? new URL(referer).pathname : "?";
    } catch { /* hors contexte de requete */ }
    console.warn(`[auth] refus role=${session.role.toLowerCase()} attendus=${roles.join(",")} page=${page}`);
    throw new Error("Action non autorisée pour votre profil.");
  }

  return session;
}
