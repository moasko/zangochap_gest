import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("lib/stale-server-action.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
let reloads = 0;
const values = new Map();
const storage = {
  getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
function load(sessionStorage) {
  const context = { exports: {}, Error, sessionStorage, window: { location: { reload: () => { reloads++; } } } };
  vm.runInNewContext(source, context);
  return context.exports;
}
const api = load(storage);
assert.equal(api.reloadOnStaleServerAction(new Error("Invalid input")), false);
assert.equal(api.reloadOnStaleServerAction(new Error("Failed to find Server Action")), true);
assert.equal(api.reloadOnStaleServerAction(new Error("Failed to find Server Action")), false);
assert.equal(reloads, 1);
const blocked = load({ getItem() { throw new Error("Storage blocked"); }, removeItem() { throw new Error("Storage blocked"); } });
assert.equal(blocked.reloadOnStaleServerAction(new Error("Failed to find Server Action")), false);
assert.doesNotThrow(() => blocked.clearStaleServerActionReloadFlag());
assert.equal(reloads, 1);
console.log("PASS: stale-action reload once, ordinary errors unchanged, blocked storage cannot cause reload loops.");
