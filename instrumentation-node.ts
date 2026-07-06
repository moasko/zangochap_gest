// Planificateur des automatisations (runtime Node uniquement — importe depuis
// instrumentation.ts derriere un garde NEXT_RUNTIME pour ne jamais etre inclus
// dans le bundle Edge). VPS Dokploy : process Node persistant, pas de cron externe.
// Tick chaque minute : file d'attente (envois differes / reportes hors fenetre)
// puis regles planifiees, chacune avec son propre anti-doublon en CmsContent.

import { runAutomationTick } from "@/modules/automations/engine";

// En dev, ce module peut etre recharge lors des recompilations : un seul timer.
const globalScope = globalThis as typeof globalThis & { __zangochapAutomationTimer?: boolean };

if (!globalScope.__zangochapAutomationTimer) {
  globalScope.__zangochapAutomationTimer = true;

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runAutomationTick();
    } finally {
      running = false;
    }
  }, 60_000);
}
