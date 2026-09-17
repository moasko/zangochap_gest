// Isolated workflow tests: mocked PostgreSQL/Prisma and external effects, no real data or network.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let session;
let store;
let failNotification = false;
let externalCalls = 0;
let writes = 0;
let uploads = 0;
let transactionQueue = Promise.resolve();
const original = { id: "original", ref: "BJ00001", commercialId: "commercial", status: "CONFIRMED",
  updatedAt: new Date("2026-09-17T00:00:00Z"), deliveryDate: new Date("2026-09-18T00:00:00Z"),
  deletedAt: null, settlementId: null, history: [], stockDecremented: true, deliverymanId: "rider", deliverymanName: "Rider" };
const commercial = { id: "commercial", email: "commercial@example.test", name: "Commercial test", role: "COMMERCIAL" };
const admin = { id: "admin", email: "admin@example.test", name: "Admin test", role: "admin", initials: "AT" };
const payload = { customerName: "Client test", customerPhone: "0000000000", customerLocation: "Lieu test", commune: "Commune test",
  deliveryFee: 1000, total: 2000, deliveryDate: "2099-01-01", reason: "Client absent",
  items: [{ name: "Article test", productId: "product", variantId: "variant", size: "M", color: "Noir", qty: 1, price: 2000 }] };
function reset() {
  store = { orders: [structuredClone(original)], requests: [], messages: [], customers: [], giftRequests: [] };
  session = { ...commercial, role: "commercial", initials: "CT" };
  failNotification = false; externalCalls = 0; writes = 0; uploads = 0;
}
function matchesJson(row, condition) {
  return condition.path.reduce((value, key) => value?.[key], row.data) === condition.equals;
}
const database = {
  $queryRaw: async () => [],
  $executeRaw: async () => 1,
  cmsContent: {
    findFirst: async ({ where }) => store.requests.find(row => where.AND.every(condition => matchesJson(row, condition.data))),
    findUnique: async ({ where }) => store.requests.find(row => row.key === where.key) || null,
    findMany: async ({ where }) => store.requests.filter(row => !where.data || matchesJson(row, where.data)),
    create: async ({ data }) => { writes++; const row = structuredClone(data); store.requests.push(row); return row; },
    update: async ({ where, data }) => { writes++; const row = store.requests.find(row => row.key === where.key); Object.assign(row, structuredClone(data)); return row; },
  },
  order: {
    findUnique: async ({ where }) => structuredClone(store.orders.find(row => where.id ? row.id === where.id : row.ref === where.ref) || null),
    findMany: async () => structuredClone(store.orders),
    create: async ({ data }) => {
      writes++;
      const order = { ...structuredClone(data), id: `new-${store.orders.length}`, updatedAt: new Date(), items: data.items.create.map((item, index) => ({ ...item, id: `item-${store.orders.length}-${index}` })) };
      store.orders.push(order); return structuredClone(order);
    },
    update: async ({ where, data }) => { writes++; const order = store.orders.find(row => row.id === where.id); Object.assign(order, structuredClone(data), { updatedAt: new Date() }); return structuredClone(order); },
  },
  user: {
    findUnique: async ({ where }) => where.id === commercial.id ? { ...structuredClone(commercial), giftMonthlyQuota: 0, giftMonthlyValueQuota: 0 } : null,
    findMany: async () => [structuredClone(commercial)],
  },
  customer: { upsert: async ({ create }) => { writes++; const customer = { ...create, id: "customer" }; store.customers.push(customer); return customer; } },
  product: { findMany: async () => [{ id: "product", price: 2000 }] },
  orderItem: { findMany: async () => [] },
  giftApprovalRequest: { createMany: async ({ data }) => { store.giftRequests.push(...structuredClone(data)); return { count: data.length }; } },
  chatMessage: { create: async ({ data }) => { if (failNotification) throw new Error("Simulated notification write failure"); writes++; store.messages.push(structuredClone(data)); return data; } },
  $transaction: fn => {
    const run = transactionQueue.then(async () => {
      const before = structuredClone(store);
      try { return await fn(database); } catch (error) { store = before; throw error; }
    });
    transactionQueue = run.catch(() => {});
    return run;
  },
};
async function ensureAuth(roles) {
  if (!session || (roles && !roles.includes(session.role) && session.role !== "developer")) throw new Error("Accès refusé");
  return session;
}
function load(path, extra = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const scope = { exports: {}, Date, console, require: name => {
    if (name in extra) return extra[name];
    if (name === "@/lib/prisma") return { __esModule: true, default: database };
    if (name === "@/lib/auth") return { ensureAuth };
    if (name === "@/modules/auth/actions") return { getSession: async () => session };
    if (name === "next/cache") return { revalidatePath: () => {} };
    if (name === "@/lib/upload") return { uploadImage: async () => { uploads++; return "https://media.example.test/request.webp"; } };
    if (name === "@/modules/whatsapp/send") return { notifyOrderCreatedWhatsApp: async () => { externalCalls++; } };
    if (name === "@/modules/automations/engine") return { triggerAutomations: async () => { externalCalls++; } };
    return require(name);
  } };
  vm.runInNewContext(compiled, scope, { filename: path }); return scope.exports;
}
const types = load("modules/orders/types/reprogramming.ts");
const helpers = load("modules/orders/helpers/index.ts", { "@/lib/constants": { COMMUNES: {} } });
const creation = load("modules/orders/actions/order-creation-service.ts", {
  "../helpers": helpers, "../helpers/expedition-day": {},
});
const actions = load("modules/orders/actions/reprogramming-actions.ts", {
  "../helpers": helpers, "./order-creation-service": creation, "../types/reprogramming": types,
});
const orders = load("modules/orders/actions/order-actions.ts", {
  "../helpers": helpers, "./order-creation-service": creation, "./reprogramming-actions": actions,
  "./stock": {}, "@/modules/developer/audit": {},
});
const statusActions = load("modules/orders/actions/status-actions.ts", {
  "../helpers": helpers, "./reprogramming-actions": actions, "./stock": {},
});

reset();
const before = JSON.stringify(store.orders);
const requested = await orders.reprogramOrder(original.id, { ...payload, source: "public", status: "DELIVERED", commercialId: "admin" });
assert.equal(requested.approvalRequired, true);
assert.equal(JSON.stringify(store.orders), before, "Pending request must not mutate the original or create a new order");
assert.equal(store.customers.length, 0, "No CRM writes before approval");
assert.equal(externalCalls, 0, "No WhatsApp/automation before approval");
assert.equal(store.messages[0].targetRole, "ADMIN");
assert.equal(requested.request.payload.source, undefined, "Sensitive fields must be stripped");
await assert.rejects(() => actions.requestOrderReprogramming(original.id, payload), /déjà/);
await assert.rejects(() => actions.reviewOrderReprogramming(requested.request.id, "APPROVED"), /Accès/);
session = admin;
const approved = await actions.reviewOrderReprogramming(requested.request.id, "APPROVED");
assert.equal(approved.status, "APPROVED");
assert.equal(store.orders.length, 2);
assert.equal(store.orders[1].commercialId, commercial.id, "New order keeps the requesting commercial");
assert.equal(store.orders[1].confirmedByName, admin.name);
assert.equal(store.orders[1].status, "CONFIRMED");
assert.equal(store.orders[1].type, "Reprogrammé");
assert.equal(store.orders[0].deliveryDate.toISOString(), original.deliveryDate.toISOString());
assert.equal(externalCalls, 2, "Notifications run after approval");
const writeCount = writes;
await actions.reviewOrderReprogramming(requested.request.id, "APPROVED");
assert.equal(writes, writeCount, "Repeated approval is idempotent");
await assert.rejects(() => actions.reviewOrderReprogramming(requested.request.id, "REJECTED", "Refus"), /déjà/);

reset();
const rejected = await actions.requestOrderReprogramming(original.id, payload);
session = admin;
await assert.rejects(() => actions.reviewOrderReprogramming(rejected.request.id, "REJECTED"), /motif/);
await actions.reviewOrderReprogramming(rejected.request.id, "REJECTED", "Date à revoir");
assert.equal(JSON.stringify(store.orders), before);
assert.equal(store.customers.length, 0);
assert.equal(externalCalls, 0);
session = { ...commercial, role: "commercial" };
await actions.requestOrderReprogramming(original.id, payload); // A rejected request does not permanently block the order.

reset();
session.id = "other-commercial";
await assert.rejects(() => actions.requestOrderReprogramming(original.id, payload), /Accès/);
const customPayload = { ...payload, items: [{ ...payload.items[0], isCustom: true, image: "data:image/png;base64,AAAA" }] };
await assert.rejects(() => actions.requestOrderReprogramming(original.id, customPayload), /Accès/);
assert.equal(uploads, 0, "Ownership must be checked before uploading custom media");
reset();
const media = await actions.requestOrderReprogramming(original.id, customPayload);
assert.equal(uploads, 1);
assert.equal(media.request.payload.items[0].image, "https://media.example.test/request.webp");
session = admin;
await actions.reviewOrderReprogramming(media.request.id, "APPROVED");
assert.equal(uploads, 1, "Approval must not upload media inside its transaction");
reset();
await assert.rejects(() => actions.requestOrderReprogramming(original.id, { ...payload, deliveryDate: "2099-02-31" }), /date/);
await assert.rejects(() => actions.requestOrderReprogramming(original.id, { ...payload, deliveryDate: "2000-01-01" }), /date/);
await assert.rejects(() => actions.requestOrderReprogramming(original.id, { ...payload, items: [{ ...payload.items[0], qty: -1 }] }));
await assert.rejects(() => orders.createOrder({ ...payload, type: "Reprogrammé" }), /validation/);
await assert.rejects(() => statusActions.updateOrderStatus(original.id, "REPROGRAMMED"), /validation/);

reset();
const stale = await actions.requestOrderReprogramming(original.id, payload);
store.orders[0].updatedAt = new Date("2026-09-18T00:00:00Z");
session = admin;
await assert.rejects(() => actions.reviewOrderReprogramming(stale.request.id, "APPROVED"), /changé/);
assert.equal(store.requests[0].data.status, "PENDING");
assert.equal(store.orders.length, 1);

reset();
const failure = await actions.requestOrderReprogramming(original.id, payload);
session = admin; failNotification = true;
await assert.rejects(() => actions.reviewOrderReprogramming(failure.request.id, "APPROVED"), /Simulated/);
assert.equal(store.orders.length, 1, "Order creation rolls back with approval failure");
assert.equal(store.customers.length, 0, "CRM creation rolls back too");
assert.equal(store.requests[0].data.status, "PENDING");
assert.equal(externalCalls, 0);

reset();
const simultaneous = await Promise.allSettled([actions.requestOrderReprogramming(original.id, payload), actions.requestOrderReprogramming(original.id, payload)]);
assert.equal(simultaneous.filter(result => result.status === "fulfilled").length, 1);
session = admin;
const id = store.requests[0].data.id;
await Promise.all([actions.reviewOrderReprogramming(id, "APPROVED"), actions.reviewOrderReprogramming(id, "APPROVED")]);
assert.equal(store.orders.length, 2, "Concurrent approvals must not create two orders");

reset();
store.orders.push({ ...structuredClone(original), id: "existing-repro", ref: "REPROBJ00001", commercialId: "other" });
const collision = await actions.requestOrderReprogramming(original.id, payload);
session = admin;
const alternative = await actions.reviewOrderReprogramming(collision.request.id, "APPROVED");
assert.notEqual(alternative.newOrderRef, "REPROBJ00001", "An existing reprogrammed ref must get a new available ref");

reset();
const gifted = await actions.requestOrderReprogramming(original.id, { ...payload, total: 0, items: [{ ...payload.items[0], isGift: true, price: 0, originalPrice: 2000 }] });
session = admin;
await actions.reviewOrderReprogramming(gifted.request.id, "APPROVED");
assert.equal(store.orders[1].items[0].giftApprovalStatus, "PENDING", "Reprogramming approval must not bypass the commercial gift quota");
assert.equal(store.giftRequests.length, 1);
assert.equal(store.messages.find(message => message.body.includes("Demande cadeau")).senderRole, "COMMERCIAL");

reset();
const report = await statusActions.updateOrderStatus(original.id, "REPRO_DISPO", "Client indisponible", undefined, "2099-01-02");
assert.equal(report.approvalRequired, true);
assert.equal(JSON.stringify(store.orders), before);
session = admin;
await actions.reviewOrderReprogramming(store.requests[0].data.id, "APPROVED");
assert.equal(store.orders.length, 1);
assert.equal(store.orders[0].status, "REPRO_DISPO");
assert.equal(store.orders[0].deliveryDate.getFullYear(), 2099);
assert.equal(store.orders[0].stockDecremented, true, "Repro-dispo keeps the shipping stock state");

reset();
store.orders[0].status = "DELIVERED";
await assert.rejects(() => actions.requestOrderReprogramming(original.id, { deliveryDate: "2099-01-01", reason: "Report" }, "REPRO_DISPO"), /clôturée/);
reset();
const mine = await actions.requestOrderReprogramming(original.id, payload);
assert.equal((await actions.getReprogrammingRequests()).length, 1);
session.id = "other-commercial";
assert.equal((await actions.getReprogrammingRequests()).length, 0, "Commercial can only read their own requests");
session = { ...admin, role: "developer" };
assert.equal((await actions.reviewOrderReprogramming(mine.request.id, "APPROVED")).status, "APPROVED");

reset();
session = admin;
const direct = await orders.reprogramOrder(original.id, payload);
assert.equal(direct.order.status, "CONFIRMED", "Admin can still directly reprogram");
assert.equal(store.requests.length, 0);
assert.equal(store.orders.length, 2);

reset();
const ordinary = await orders.createOrder(payload);
assert.equal(ordinary.order.status, "CONFIRMED", "Ordinary staff creation is unchanged");
assert.equal(ordinary.order.commercialId, commercial.id);
assert.equal(externalCalls, 2);

reset(); session = null;
const web = await orders.createPublicOrder(payload);
assert.equal(web.success, true, "Public checkout remains usable without a staff session");
assert.equal(web.order.status, "TO_PROCESS");
assert.equal(web.order.commercialId, commercial.id);
assert.equal(externalCalls, 1, "Web TO_PROCESS triggers automations but not confirmed WhatsApp");
console.log("OK: pending leaves orders/CRM unchanged, rights, validation, approve/refuse, attribution, stale requests, rollback, duplicate requests/approvals, repro-dispo and visibility. Mocked DB only.");
