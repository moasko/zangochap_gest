"use client";

const STALE_SERVER_ACTION_RELOAD_KEY = "zangochap_stale_server_action_reload";
// Un rechargement au plus par fenetre : evite les boucles, mais permet de se remettre
// a jour apres chaque nouveau deploiement (l'ancien verrou "1" ne se levait jamais).
const RELOAD_GUARD_MS = 10 * 60 * 1000;
export const APP_OUTDATED_EVENT = "zangochap:app-outdated";

/** Vrai quand le serveur ne connait plus l'action : l'onglet tourne sur une ancienne version. */
export function isStaleServerActionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Failed to find Server Action") || message.includes("older or newer deployment");
}

/** Signale a l'interface (bandeau) que l'onglet est sur une ancienne version. */
export function markAppOutdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(APP_OUTDATED_EVENT));
}

export function reloadOnStaleServerAction(error: unknown) {
  if (!isStaleServerActionError(error) || typeof window === "undefined") return false;

  try {
    const last = Number(sessionStorage.getItem(STALE_SERVER_ACTION_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && Date.now() - last < RELOAD_GUARD_MS) {
      markAppOutdated();
      return false;
    }
    sessionStorage.setItem(STALE_SERVER_ACTION_RELOAD_KEY, String(Date.now()));
  } catch {
    // Do not reload without a persistent guard: it could create a reload loop.
    markAppOutdated();
    return false;
  }
  window.location.reload();
  return true;
}

export function clearStaleServerActionReloadFlag() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(STALE_SERVER_ACTION_RELOAD_KEY); } catch { /* Storage may be blocked. */ }
}
