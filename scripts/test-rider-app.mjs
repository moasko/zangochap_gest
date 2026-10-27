// Tests isoles de l'API de l'application livreur : Prisma et en-tetes simules,
// aucune connexion ni ecriture en base. node scripts/test-rider-app.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const { SignJWT, jwtVerify } = require("jose");
process.env.JWT_SECRET = "test-secret-for-rider-app";

// ---------- Etat simule ----------
let cookie = null;
let authorization = null;
const users = [
  { id: "rider-1", email: "rider@example.invalid", name: "Livreur Test", role: "LIVREUR", initials: "LT", phone: "0700000099", serviceLabel: null, password: bcrypt.hashSync("bon-mot-de-passe", 4) },
  { id: "admin-1", email: "admin@example.invalid", name: "Admin", role: "ADMIN", initials: "AD", phone: "0700000098", serviceLabel: null, password: bcrypt.hashSync("bon-mot-de-passe", 4) },
];
let orders = [];
let trackingState = null;
let points = [];
const cms = new Map();
const chat = [];

const matches = (row, where) => Object.entries(where).every(([key, condition]) => {
  if (key === "AND") return condition.every((c) => matches(row, c));
  if (key === "OR") return condition.some((c) => matches(row, c));
  if (condition === null) return row[key] == null;
  if (typeof condition !== "object" || condition instanceof Date) return row[key] === condition;
  return Object.entries(condition).every(([op, value]) => {
    if (op === "in") return value.includes(row[key]);
    if (row[key] == null) return false;
    return op === "lte" ? row[key] <= value : op === "lt" ? row[key] < value : op === "gte" ? row[key] >= value : false;
  });
});

const database = {
  $queryRaw: async () => [],
  $transaction: async (fn) => (Array.isArray(fn) ? Promise.all(fn) : fn(database)),
  user: {
    findUnique: async ({ where }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
    findFirst: async ({ where }) => users.find((u) => (where.email ? u.email === where.email : where.phone?.in?.includes(u.phone)) && (!where.role || u.role === where.role)) ?? null,
  },
  order: {
    findUnique: async ({ where }) => orders.find((o) => o.id === where.id) ?? null,
    update: async ({ where, data }) => { const order = orders.find((o) => o.id === where.id); Object.assign(order, data); return order; },
    findMany: async ({ where }) => orders.filter((o) => o.deliverymanId === where.deliverymanId || o.lastDeliveryAttemptRiderId === where.lastDeliveryAttemptRiderId).filter((o) => where.status.in.includes(o.status)).filter((o) => (where.settlementId === null ? !o.settlementId : true)),
  },
  cmsContent: { findUnique: async ({ where }) => cms.get(where.key) ?? null, create: async ({ data }) => { cms.set(data.key, data); return data; } },
  chatMessage: { create: async ({ data }) => { chat.push(data); return data; } },
  riderTrackingState: {
    upsert: async ({ create, update }) => { trackingState = trackingState ? { ...trackingState, ...update } : { ...create }; },
    updateMany: async ({ where, data }) => { if (!trackingState || !matches(trackingState, where)) return { count: 0 }; trackingState = { ...trackingState, ...data }; return { count: 1 }; },
    findUnique: async () => trackingState,
  },
  riderLocationPoint: { create: async ({ data }) => { points.push(data); } },
};

const cache = new Map();
function load(path, extra = {}) {
  if (cache.has(path)) return cache.get(path);
  const source = fs.readFileSync(path, "utf8").replace(/^"use server";/m, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const scope = {
    exports: {}, console, Date, Buffer, TextEncoder, process,
    require: (name) => {
      if (extra[name]) return extra[name];
      if (name === "@/lib/prisma") return { __esModule: true, default: database };
      if (name === "next/headers") return { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set() {}, delete() {} }), headers: async () => ({ get: (key) => (key === "authorization" ? authorization : null) }) };
      if (name === "next/navigation") return { redirect: () => { throw new Error("redirect"); } };
      if (name === "next/cache") return { revalidatePath() {} };
      if (name === "@/lib/jwt-secret") return load("lib/jwt-secret.ts");
      if (name === "@/modules/mobile-api/errors") return load("modules/mobile-api/errors.ts");
      if (name === "./validation") return load("modules/rider-tracking/validation.ts");
      return require(name);
    },
  };
  vm.runInNewContext(compiled, scope);
  cache.set(path, scope.exports);
  return scope.exports;
}

const { getJwtSecret, RIDER_APP_AUDIENCE } = load("lib/jwt-secret.ts");
const auth = load("modules/auth/actions.ts");
const riderAuth = load("modules/rider-app/auth.ts");

// ---------- Connexion livreur ----------
await assert.rejects(riderAuth.loginRider({ identifier: "rider@example.invalid", password: "faux" }), /incorrect/i, "mauvais mot de passe refuse");
await assert.rejects(riderAuth.loginRider({ identifier: "inconnu@example.invalid", password: "x" }), /incorrect/i, "compte inconnu : meme message");
await assert.rejects(riderAuth.loginRider({ identifier: "admin@example.invalid", password: "bon-mot-de-passe" }), /reservee aux livreurs/i, "un admin ne peut pas se connecter a l'app livreur");
const byPhone = await riderAuth.loginRider({ identifier: "+225 07 00 00 00 99", password: "bon-mot-de-passe" });
assert.equal(byPhone.rider.id, "rider-1", "connexion par telephone (format international)");
const { token } = await riderAuth.loginRider({ identifier: "RIDER@example.invalid", password: "bon-mot-de-passe" });
const { payload } = await jwtVerify(token, getJwtSecret(), { audience: RIDER_APP_AUDIENCE });
assert.equal(payload.id, "rider-1");

// ---------- getSession : en-tete Authorization ----------
authorization = `Bearer ${token}`;
assert.equal((await auth.getSession())?.id, "rider-1", "jeton de l'app accepte en en-tete");
const staffToken = await new SignJWT({ id: "admin-1", email: "admin@example.invalid", name: "Admin", role: "admin" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(getJwtSecret());
authorization = `Bearer ${staffToken}`;
assert.equal(await auth.getSession(), null, "un jeton staff (sans audience) est refuse en en-tete");
authorization = "Bearer abc.def.ghi";
assert.equal(await auth.getSession(), null, "jeton forge refuse");
authorization = null;
cookie = staffToken;
assert.equal((await auth.getSession())?.id, "admin-1", "la session cookie du back-office fonctionne toujours");
cookie = null;

// ---------- Rejeu hors ligne ----------
authorization = `Bearer ${token}`;
let updateCalls = 0;
const api = load("modules/rider-app/api.ts", {
  "@/modules/auth/actions": auth,
  "@/modules/chat/actions": { sendOrderSupportAlert: async () => ({ success: true }) },
  "@/modules/orders/actions": {
    updateOrderStatus: async () => { updateCalls += 1; throw new Error("Cette livraison est deja cloturee. Utilisez la correction administrateur."); },
    markPartialDelivery: async () => { updateCalls += 1; },
  },
});
orders = [{ id: "o-1", status: "DELIVERED", deliverymanId: "rider-1", lastDeliveryAttemptRiderId: null }];
assert.deepEqual(JSON.parse(JSON.stringify(await api.setMissionStatus("o-1", { status: "DELIVERED", amountReceived: 5000 }))), { ok: true, replayed: true }, "action deja appliquee : succes sans rappel");
assert.equal(updateCalls, 0);
orders = [{ id: "o-2", status: "ON_DELIVERY", deliverymanId: "rider-1", lastDeliveryAttemptRiderId: null }];
await assert.rejects(api.setMissionStatus("o-2", { status: "RETURNED" }), /motif/i, "retour sans motif refuse");
await assert.rejects(api.setMissionStatus("o-2", { status: "DELIVERED" }), (error) => error.status === 422 && /cloturee/.test(error.message), "refus metier remonte en 422 avec le message");
authorization = null;
await assert.rejects(api.requireRider(), (error) => error.status === 401, "sans jeton : 401");

// ---------- GPS en lot ----------
const ingest = load("modules/rider-tracking/ingest.ts");
const session = "00000000-0000-4000-8000-000000000001";
await ingest.ingestTracking("rider-1", { action: "start", sessionId: session });
const base = Date.now() - 10 * 60_000;
const point = (i, offsetMs) => ({ action: "point", sessionId: session, id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, latitude: 5.3 + i / 1000, longitude: -4, accuracy: 10, capturedAt: new Date(base + offsetMs).toISOString() });
const accepted = [];
for (const [i, offset] of [[1, 0], [2, 15_000], [3, 18_000], [4, 40_000]]) accepted.push((await ingest.ingestTracking("rider-1", point(i, offset), { queued: true })).accepted);
assert.deepEqual(accepted, [true, true, false, true], "lot hors ligne : points espaces >= 8 s acceptes, trop rapproches ignores");
assert.equal(points.length, 3);
assert.equal((await ingest.ingestTracking("rider-1", point(9, 0))).accepted, false, "envoi direct d'un point ancien refuse (comportement web inchange)");

// ---------- Traces de tournee et cloture de caisse ----------
const tour = load("modules/rider-app/tour.ts");
const rider = { id: "rider-1", email: "rider@example.invalid", name: "Livreur Test" };
orders = [
  { id: "o-3", ref: "AB1", customerName: "Client A", status: "ON_DELIVERY", deliverymanId: "rider-1", history: [], total: 10000, deliveryFee: 1500, discount: 0, amountReceived: null, settlementId: null },
  { id: "o-4", ref: "AB2", customerName: "Client B", status: "DELIVERED", deliverymanId: "rider-1", history: [], total: 8000, deliveryFee: 1500, discount: 500, amountReceived: 9000, settlementId: null },
  { id: "o-5", ref: "AB3", customerName: "Client C", status: "ON_DELIVERY", deliverymanId: "rider-2", history: [] },
];
const at = new Date().toISOString();
await tour.addMissionNote(rider, "o-3", { kind: "en_route", at });
assert.equal((await tour.addMissionNote(rider, "o-3", { kind: "en_route", at })).replayed, true, "trace rejouee : pas de doublon");
assert.equal(orders[0].history.length, 1);
await tour.addMissionNote(rider, "o-3", { kind: "call_no_answer", calls: 2 });
assert.match(orders[0].history[1].action, /2 appel/);
await assert.rejects(tour.addMissionNote(rider, "o-5", { kind: "en_route" }), (error) => error.status === 403, "trace sur la mission d'un autre livreur refusee");
const day = new Date().toISOString().slice(0, 10);
const report = await tour.submitCashReport(rider, { date: day, note: "RAS" });
assert.equal(report.toSettle, 9000, "montant a regulariser calcule par le serveur (montant encaisse saisi)");
assert.equal(chat.length, 2, "cloture envoyee aux administrateurs et aux comptables");
assert.ok(chat.every((message) => message.scope === "ROLE" && message.body.startsWith("[CAISSE LIVREUR]")));
assert.equal((await tour.submitCashReport(rider, { date: day })).alreadySubmitted, true, "une seule cloture par jour");
assert.equal(chat.length, 2);

console.log("OK: traces de tournee (rejeu, droits), cloture de caisse (calcul serveur, envoi bureau, unicite).");
console.log("OK: connexion livreur (e-mail/telephone, roles, pas d'enumeration), jeton d'app en en-tete (audience obligatoire, cookie staff intact), rejeu hors ligne idempotent, refus metier en 422, GPS par lots. Base simulee uniquement.");
