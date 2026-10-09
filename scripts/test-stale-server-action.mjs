import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("lib/stale-server-action.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
let reloads = 0;
let outdatedEvents = 0;
let now = 1_000_000;
const values = new Map();
const storage = {
  getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
function load(sessionStorage) {
  const context = {
    exports: {}, Error, String, Number, sessionStorage,
    Date: { now: () => now },
    Event: class { constructor(type) { this.type = type; } },
    window: {
      location: { reload: () => { reloads++; } },
      dispatchEvent: (event) => { if (event.type === "zangochap:app-outdated") outdatedEvents++; },
    },
  };
  vm.runInNewContext(source, context);
  return context.exports;
}
const api = load(storage);
assert.equal(api.isStaleServerActionError(new Error("Failed to find Server Action \"abc\"")), true);
assert.equal(api.isStaleServerActionError(new Error("Invalid input")), false);
assert.equal(api.reloadOnStaleServerAction(new Error("Invalid input")), false);
assert.equal(api.reloadOnStaleServerAction(new Error("Failed to find Server Action")), true);
// Juste apres : pas de deuxieme rechargement (anti-boucle), le bandeau est propose a la place.
assert.equal(api.reloadOnStaleServerAction(new Error("Failed to find Server Action")), false);
assert.equal(reloads, 1);
assert.equal(outdatedEvents, 1);
// Apres un nouveau deploiement (plus de 10 min plus tard) : rechargement de nouveau possible.
now += 11 * 60 * 1000;
assert.equal(api.reloadOnStaleServerAction(new Error("older or newer deployment")), true);
assert.equal(reloads, 2);
// Stockage bloque : jamais de rechargement (pas de garde = risque de boucle), bandeau a la place.
const blocked = load({ getItem() { throw new Error("Storage blocked"); }, removeItem() { throw new Error("Storage blocked"); } });
assert.equal(blocked.reloadOnStaleServerAction(new Error("Failed to find Server Action")), false);
assert.doesNotThrow(() => blocked.clearStaleServerActionReloadFlag());
assert.equal(reloads, 2);
assert.equal(outdatedEvents, 2);
console.log("PASS: stale-action reload once per 10 min, banner otherwise, ordinary errors unchanged, blocked storage cannot cause reload loops.");
