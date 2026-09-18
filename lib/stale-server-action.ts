"use client";

const STALE_SERVER_ACTION_RELOAD_KEY = "zangochap_stale_server_action_reload";

export function reloadOnStaleServerAction(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const isStaleServerAction =
    message.includes("Failed to find Server Action") ||
    message.includes("older or newer deployment");

  if (!isStaleServerAction || typeof window === "undefined") return false;

  try {
    if (sessionStorage.getItem(STALE_SERVER_ACTION_RELOAD_KEY) === "1") return false;
    sessionStorage.setItem(STALE_SERVER_ACTION_RELOAD_KEY, "1");
  } catch {
    // Do not reload without a persistent guard: it could create a reload loop.
    return false;
  }
  window.location.reload();
  return true;
}

export function clearStaleServerActionReloadFlag() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(STALE_SERVER_ACTION_RELOAD_KEY); } catch { /* Storage may be blocked. */ }
}
