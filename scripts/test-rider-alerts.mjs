// Isolated regression checks; no database or network access.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, ...globals }, { filename: path });
  return exports;
}
let session = { id: "commercial-a", role: "commercial" };
let query;
let paused = false;
const date = new Date("2026-09-17T00:00:00Z");
const api = load("modules/chat/actions.ts", {
  "next/cache": { revalidatePath() {} },
  "@/modules/auth/actions": { getSession: async () => session },
  "@/lib/rider-alert-events": { emitRiderAlert() {} },
  "@/lib/prisma": { user: { findUnique: async () => ({ isPaused: paused }) }, chatMessage: { findMany: async args => {
    query = args;
    return [{ id: "a", body: "[ALERTE LIVREUR] Test", senderName: "Livreur test", sender: { phone: null }, createdAt: date }];
  } } },
});
const alerts = await api.getUnreadRiderAlerts();
assert.equal(alerts[0].createdAt, date.toISOString());
assert.equal(query.where.deletedAt, null);
assert.equal(query.where.senderRole, "LIVREUR");
assert.equal(query.where.senderId.not, session.id);
assert.equal(query.where.reads.none.userId, session.id);
assert.equal(query.where.body.contains, "[ALERTE LIVREUR]");
assert.equal(query.where.OR[1].targetRole, "COMMERCIAL");
assert.equal(query.where.OR[2].OR[1].recipientId, session.id);
assert.equal(query.take, 50);
assert.equal(query.orderBy[0].createdAt, "asc");
assert.equal(query.orderBy[1].id, "asc");
await api.getUnreadRiderAlerts({ id: "a", createdAt: date.toISOString() });
assert.equal(query.where.AND[0].OR[0].createdAt.gt.toISOString(), date.toISOString());
assert.equal(query.where.AND[0].OR[1].id.gt, "a");
paused = true;
await api.getUnreadRiderAlerts();
assert.equal(query.where.NOT.targetRole, "COMMERCIAL");
await assert.rejects(api.getUnreadRiderAlerts({ id: "a", createdAt: "invalid" }), /invalide/);
session = null;
await assert.rejects(api.getUnreadRiderAlerts(), /Non authentifie/);
session = { id: "outsider", role: "customer" };
await assert.rejects(api.getUnreadRiderAlerts(), /reserve/);

const client = load("lib/client-alerts.ts", {}, { window: {
  get sessionStorage() { throw new Error("Storage blocked"); },
} });
assert.equal(client.hasSeenRiderAlert("alert"), false);
client.markRiderAlertSeen("alert");
assert.equal(client.hasSeenRiderAlert("alert"), true);
console.log("Rider alerts: authenticated visibility, unread recovery, stable pagination and blocked-storage deduplication PASS");
