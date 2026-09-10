// Isolated route tests: mocked Prisma only, no connection or database writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { Prisma } = require("@prisma/client");
let session = { id: "rider-a", role: "livreur" };
let state = null;
let points = [];
let historyWhere;
function matches(row, where) {
  return row && Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return condition.every(c => matches(row, c));
    if (key === "OR") return condition.some(c => matches(row, c));
    if (condition === null) return row[key] == null;
    if (typeof condition !== "object") return row[key] === condition;
    return Object.entries(condition).every(([op, value]) => row[key] != null && (op === "lte" ? row[key] <= value : op === "gte" ? row[key] >= value : op === "lt" ? row[key] < value : false));
  });
}
const database = {
  $queryRaw: async () => [],
  riderTrackingState: {
    upsert: async ({ create, update }) => { state = state ? { ...state, ...update } : { ...create }; },
    updateMany: async ({ where, data }) => { if (!matches(state, where)) return { count: 0 }; state = { ...state, ...data }; return { count: 1 }; },
    findUnique: async ({ where }) => state?.riderId === where.riderId ? state : null,
    findMany: async () => state ? [state] : [],
  },
  riderLocationPoint: {
    create: async ({ data }) => {
      if (points.some(p => p.id === data.id)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
      points.push(data);
    },
    count: async ({ where }) => { historyWhere = where; return points.filter(p => matches(p, where)).length; },
    findMany: async ({ where, take }) => points.filter(p => matches(p, where)).sort((a,b) => a.capturedAt - b.capturedAt).slice(0, take),
  },
  user: { findMany: async () => [{ id: "rider-a", name: "Demo A" }, { id: "rider-b", name: "Demo B" }] },
  $transaction: async fn => {
    const oldState = state && { ...state }, oldPoints = [...points];
    try { return await fn(database); } catch (error) { state = oldState; points = oldPoints; throw error; }
  },
};
function load(path) {
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const scope = { exports: {}, Date, require: name => {
    if (name === "@/lib/prisma") return { __esModule: true, default: database };
    if (name === "@/modules/auth/actions") return { getSession: async () => session };
    if (name === "@/modules/rider-tracking/validation") return validation;
    return require(name);
  } };
  vm.runInNewContext(compiled, scope); return scope.exports;
}
const validation = load("modules/rider-tracking/validation.ts");
const { trackingStatus } = load("modules/rider-tracking/types.ts");
const { POST } = load("app/api/rider-tracking/route.ts");
const { GET } = load("app/api/admin/rider-tracking/route.ts");
const token = "00000000-0000-4000-8000-000000000001";
const replacement = "00000000-0000-4000-8000-000000000002";
const point = (overrides = {}) => ({ action: "point", sessionId: token, id: "00000000-0000-4000-8000-000000000003", latitude: 5.36, longitude: -4, accuracy: 12, capturedAt: new Date().toISOString(), ...overrides });
const post = (body, origin = "https://demo.test") => POST(new NextRequest("https://demo.test/api/rider-tracking", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = query => GET(new NextRequest("https://demo.test/api/admin/rider-tracking?" + query));
const ageState = () => { state.lastReceivedAt = new Date(Date.now() - 10000); state.capturedAt = new Date(Date.now() - 10000); };
assert.equal((await post({ action: "start", sessionId: token }, "https://foreign.test")).status, 403);
assert.equal(state, null);
const proxied = await POST(new NextRequest("https://localhost:3000/api/rider-tracking", { method: "POST", headers: { origin: "https://demo.test", host: "demo.test", "content-type": "application/json" }, body: JSON.stringify({ action: "stop", sessionId: token }) }));
assert.equal(proxied.status, 200, "same-origin requests work behind the application proxy");
for (const role of [null, "admin", "commercial"]) {
  session = role ? { id: "other", role } : null;
  assert.equal((await post({ action: "start", sessionId: token })).status, 403);
}
session = { id: "rider-a", role: "livreur" };
assert.equal((await get("mode=live")).status, 403);
assert.equal((await post(point())).status, 409, "no session cannot record");
assert.equal((await post({ action: "start", sessionId: token, riderId: "rider-b" })).status, 200);
assert.equal(state.riderId, "rider-a", "identity comes from server session");
assert.equal((await post(point({ latitude: 91 }))).status, 400);
assert.equal((await post(point({ capturedAt: new Date(Date.now() - 180000).toISOString() }))).status, 400);
assert.equal((await post(point({ riderId: "rider-b" }))).status, 200);
assert.equal(points.length, 1);
assert.equal(points[0].riderId, "rider-a");
assert.equal((await (await post(point())).json()).accepted, false, "rapid reports throttled");
ageState();
assert.equal((await (await post(point())).json()).duplicate, true);
assert.equal(points.length, 1, "duplicate cannot add a second point");
assert.ok(state.lastReceivedAt < new Date(Date.now() - 8000), "failed duplicate transaction rolls back snapshot");
assert.equal((await post({ action: "stop", sessionId: replacement })).status, 200);
assert.equal(state.active, true, "old stop cannot stop current session");
await post({ action: "stop", sessionId: token });
assert.equal((await post(point())).status, 409);
assert.equal(points.length, 1, "stopped session cannot record");
await post({ action: "start", sessionId: replacement });
assert.equal((await post(point())).status, 409, "replaced session cannot record");
session = { id: "rider-b", role: "livreur" };
assert.equal((await post(point({ sessionId: replacement }))).status, 409, "another rider cannot use the token");
session = { id: "admin", role: "admin" };
assert.equal((await get("mode=live")).status, 200);
assert.equal((await get("mode=history&riderId=unknown&day=2026-09-10")).status, 400);
assert.equal((await get("mode=history&riderId=rider-a&day=2026-02-30")).status, 400);
const day = new Date().toISOString().slice(0, 10);
const history = await get("mode=history&riderId=rider-a&day=" + day);
assert.equal(history.headers.get("cache-control"), "no-store");
assert.equal((await history.json()).points.length, 1);
assert.equal(historyWhere.riderId, "rider-a");
assert.equal(historyWhere.capturedAt.gte.toISOString(), day + "T00:00:00.000Z");
assert.equal(historyWhere.capturedAt.lte.toISOString(), day + "T23:59:59.999Z");
for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
  process.env.TZ = tz;
  assert.equal(validation.historyRange("2026-09-10", "08:00", "10:30").lte.toISOString(), "2026-09-10T10:30:59.999Z");
}
assert.throws(() => validation.historyRange("2026-09-10", "12:00", "11:00"));
assert.equal(validation.distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
assert.ok(validation.distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }) > 100);
assert.equal(trackingStatus({ active: true, capturedAt: new Date().toISOString(), lastReceivedAt: new Date().toISOString() }, Date.now()), "Suivi actif");
assert.equal(trackingStatus({ active: true, capturedAt: new Date(Date.now() - 180000).toISOString(), lastReceivedAt: new Date().toISOString() }, Date.now()), "Position ancienne");
assert.equal(trackingStatus({ active: false }, Date.now()), "Arrêté");
console.log("OK: roles, origin, ownership, validation, throttling, duplicate rollback, stop/restart tokens, bounded UTC history and stale positions. Mock database only.");
