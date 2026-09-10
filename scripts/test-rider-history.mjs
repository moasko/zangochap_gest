// Tests against a mocked database: no connection and no production writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync("app/zangochap-rider/history-actions.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
let session = { id: "rider-a", role: "LIVREUR" };
const make = (id, data = {}) => ({ id, ref: id, deliverymanId: "rider-a", status: "DELIVERED", deletedAt: null, deliveredAt: "2025-01-04T15:00:00.000Z", deliveryDate: new Date("2025-01-03T00:00:00Z"), updatedAt: new Date("2026-09-10T15:00:00Z"), createdAt: new Date("2025-01-01T12:00:00Z"), lastDeliveryAttemptAt: null, customerName: "Test", items: [], ...data });
const rows = Array.from({ length: 35 }, (_, i) => make(String(i)));
rows.push(make("other", { deliverymanId: "rider-b" }), make("midnight", { deliveredAt: "2025-01-05T00:00:00.000Z" }), make("deleted", { deletedAt: new Date() }), make("issue", { status: "REPRO_DISPO", deliverymanId: "rider-b", lastDeliveryAttemptRiderId: "rider-a", lastDeliveryAttemptAt: new Date("2025-01-04T23:59:59.999Z") }));
function matches(row, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return condition.every(c => matches(row, c));
    if (key === "OR") return condition.some(c => matches(row, c));
    const value = row[key];
    if (condition === null) return value == null;
    if (typeof condition !== "object") return value === condition;
    return Object.entries(condition).every(([op, rhs]) => op === "in" ? rhs.includes(value) : op === "gte" ? value != null && value >= rhs : op === "lt" ? value != null && value < rhs : op === "contains" ? String(value || "").toLowerCase().includes(rhs.toLowerCase()) : op === "mode");
  });
}
const tx = { order: { count: async ({ where }) => rows.filter(r => matches(r, where)).length, findMany: async ({ where, skip, take }) => rows.filter(r => matches(r, where)).slice(skip, skip + take) } };
const sandbox = { exports: {}, Date, require: name => {
  if (name === "@/lib/prisma") return { __esModule: true, default: { $transaction: async fn => fn(tx) } };
  if (name === "@/modules/auth/actions") return { getSession: async () => session };
  throw new Error("Unexpected import: " + name);
} };
vm.runInNewContext(compiled, sandbox);
const get = sandbox.exports.getRiderHistory;
const input = { from: "2025-01-04", to: "2025-01-04", status: "all", search: "", page: 1 };
(async () => {
  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    process.env.TZ = tz;
    const result = await get(input);
    assert.equal(result.total, 36, "old deliveries and last rider attempt included; other rider, deleted and next midnight excluded");
    assert.equal(result.orders.length, 30);
    assert.equal(result.pages, 2);
    assert.equal((await get({ ...input, page: 2 })).orders.length, 6);
  }
  assert.equal((await get({ ...input, status: "REPRO_DISPO" })).total, 1);
  assert.equal((await get({ ...input, search: "ISSUE" })).total, 1);
  assert.equal((await get({ ...input, page: 999 })).page, 2);
  assert.equal((await get({ ...input, from: "2026-09-10", to: "2026-09-10" })).total, 0, "updatedAt does not move delivered orders");
  await assert.rejects(() => get({ ...input, from: "2025-02-30" }), /Date invalide/);
  await assert.rejects(() => get({ ...input, from: "2025-01-05" }), /début/);
  session = { id: "rider-a", role: "COMMERCIAL" };
  await assert.rejects(() => get(input), /Accès refusé/);
  session = null;
  await assert.rejects(() => get(input), /Accès refusé/);
  console.log("OK: date bounds, legacy search, pagination, ownership, roles and 3 timezones.");
})().catch(error => { console.error(error); process.exitCode = 1; });


