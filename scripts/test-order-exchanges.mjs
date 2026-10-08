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
let failWhatsApp = false;
let failRevalidation = false;
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
  type: "Echange", deliveryFee: 1000, total: 2000, deliveryDate: "2099-01-01", exchangeReason: "Problème de taille",
  items: [{ name: "Article test", productId: "product", variantId: "variant", size: "M", color: "Noir", qty: 1, price: 2000 }] };
function reset() {
  store = { orders: [structuredClone(original)], requests: [], messages: [], customers: [], giftRequests: [] };
  session = { ...commercial, role: "commercial", initials: "CT" };
  failNotification = false; failWhatsApp = false; failRevalidation = false; externalCalls = 0; writes = 0; uploads = 0;
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
  productVariant: { findMany: async () => [{ id: "variant", productId: "product" }] },
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
  const scope = { exports: {}, Date, Error, console, require: name => {
    if (name in extra) return extra[name];
    if (name === "@/lib/prisma") return { __esModule: true, default: database };
    if (name === "@/lib/auth") return { ensureAuth };
    if (name === "@/modules/auth/actions") return { getSession: async () => session };
    if (name === "next/cache") return { revalidatePath: () => { if (failRevalidation) throw new Error("Private error detail"); } };
    if (name === "@/lib/upload") return { uploadImage: async () => { uploads++; return "https://media.example.test/request.webp"; } };
    if (name === "@/modules/whatsapp/send") return { notifyOrderCreatedWhatsApp: async () => { externalCalls++; if (failWhatsApp) throw new Error("Private error detail"); } };
    if (name === "@/modules/automations/engine") return { triggerAutomations: async () => { externalCalls++; } };
    if (name === "./auto-assign-on-confirm") return { autoAssignAtConfirmation: async () => ({ assigned: false, reason: "test" }) };
    return require(name);
  } };
  vm.runInNewContext(compiled, scope, { filename: path }); return scope.exports;
}
const types = load("modules/orders/types/exchange.ts");
const diagnostics = load("modules/orders/helpers/exchange-diagnostics.ts");
const helpers = load("modules/orders/helpers/index.ts", { "@/lib/constants": { COMMUNES: {} } });
const creation = load("modules/orders/actions/order-creation-service.ts", {
  "../helpers": helpers, "../helpers/expedition-day": load("modules/orders/helpers/expedition-day.ts"),
});
const actions = load("modules/orders/actions/exchange-actions.ts", {
  "../helpers": helpers, "./order-creation-service": creation, "../types/exchange": types,
  "../helpers/exchange-diagnostics": diagnostics,
});
const orders = load("modules/orders/actions/order-actions.ts", {
  "../helpers": helpers, "./order-creation-service": creation, "./exchange-actions": actions,
  "./stock": {}, "@/modules/developer/audit": {},
});
const statusActions = load("modules/orders/actions/status-actions.ts", {
  "../helpers": helpers, "./stock": { InsufficientStockError: class extends Error {} },
});

reset();
const before = JSON.stringify(store.orders);
const requested = await orders.duplicateOrder(original.id, { ...payload, source: "public", status: "DELIVERED", commercialId: "admin" });
assert.equal(requested.approvalRequired, true);
assert.equal(JSON.stringify(store.orders), before, "Pending request must not mutate the original or create a new order");
assert.equal(store.customers.length, 0, "No CRM writes before approval");
assert.equal(externalCalls, 0, "No WhatsApp/automation before approval");
assert.equal(store.messages[0].targetRole, "ADMIN");
assert.equal(requested.request.payload.source, undefined, "Sensitive fields must be stripped");
await assert.rejects(() => actions.requestOrderExchange(original.id, payload), /déjà/);
await assert.rejects(() => actions.reviewOrderExchange(requested.request.id, "APPROVED"), /Accès/);
session = admin;
const approved = await actions.reviewOrderExchange(requested.request.id, "APPROVED");
assert.equal(approved.status, "APPROVED");
assert.equal(store.orders.length, 2);
assert.equal(store.orders[1].commercialId, commercial.id, "New order keeps the requesting commercial");
assert.equal(store.orders[1].confirmedByName, admin.name);
assert.equal(store.orders[1].status, "CONFIRMED");
assert.equal(store.orders[1].type, "Echange");
assert.equal(store.orders[0].deliveryDate.toISOString(), original.deliveryDate.toISOString());
assert.equal(externalCalls, 2, "Notifications run after approval");
const writeCount = writes;
await actions.reviewOrderExchange(requested.request.id, "APPROVED");
assert.equal(writes, writeCount, "Repeated approval is idempotent");
await assert.rejects(() => actions.reviewOrderExchange(requested.request.id, "REJECTED", "Refus"), /déjà/);

reset();
const rejected = await actions.requestOrderExchange(original.id, payload);
session = admin;
await assert.rejects(() => actions.reviewOrderExchange(rejected.request.id, "REJECTED"), /motif/);
await actions.reviewOrderExchange(rejected.request.id, "REJECTED", "Date à revoir");
assert.equal(JSON.stringify(store.orders), before);
assert.equal(store.customers.length, 0);
assert.equal(externalCalls, 0);
session = { ...commercial, role: "commercial" };
await actions.requestOrderExchange(original.id, payload); // A rejected request does not permanently block the order.

reset();
session.id = "other-commercial";
await assert.rejects(() => actions.requestOrderExchange(original.id, payload), /Accès/);
const customPayload = { ...payload, items: [{ ...payload.items[0], isCustom: true, image: "data:image/png;base64,AAAA" }] };
await assert.rejects(() => actions.requestOrderExchange(original.id, customPayload), /Accès/);
assert.equal(uploads, 0, "Ownership must be checked before uploading custom media");
reset();
const media = await actions.requestOrderExchange(original.id, customPayload);
assert.equal(uploads, 1);
assert.equal(media.request.payload.items[0].image, "https://media.example.test/request.webp");
session = admin;
await actions.reviewOrderExchange(media.request.id, "APPROVED");
assert.equal(uploads, 1, "Approval must not upload media inside its transaction");
reset();
await assert.rejects(() => actions.requestOrderExchange(original.id, { ...payload, deliveryDate: "2099-02-31" }), /date/);
await assert.rejects(() => actions.requestOrderExchange(original.id, { ...payload, deliveryDate: "2000-01-01" }), /date/);
await assert.rejects(() => actions.requestOrderExchange(original.id, { ...payload, items: [{ ...payload.items[0], qty: -1 }] }));
await assert.rejects(() => orders.createOrder({ ...payload, type: "Echange" }), /validation/);


reset();
const stale = await actions.requestOrderExchange(original.id, payload);
store.orders[0].updatedAt = new Date("2026-09-18T00:00:00Z");
session = admin;
await assert.rejects(() => actions.reviewOrderExchange(stale.request.id, "APPROVED"), /changé/);
assert.equal(store.requests[0].data.status, "PENDING");
assert.equal(store.orders.length, 1);

reset();
const failure = await actions.requestOrderExchange(original.id, payload);
session = admin; failNotification = true;
await assert.rejects(() => actions.reviewOrderExchange(failure.request.id, "APPROVED"), /Simulated/);
assert.equal(store.orders.length, 1, "Order creation rolls back with approval failure");
assert.equal(store.customers.length, 0, "CRM creation rolls back too");
assert.equal(store.requests[0].data.status, "PENDING");
assert.equal(externalCalls, 0);

reset();
const simultaneous = await Promise.allSettled([actions.requestOrderExchange(original.id, payload), actions.requestOrderExchange(original.id, payload)]);
assert.equal(simultaneous.filter(result => result.status === "fulfilled").length, 1);
session = admin;
const id = store.requests[0].data.id;
await Promise.all([actions.reviewOrderExchange(id, "APPROVED"), actions.reviewOrderExchange(id, "APPROVED")]);
assert.equal(store.orders.length, 2, "Concurrent approvals must not create two orders");

reset();
store.orders.push({ ...structuredClone(original), id: "existing-repro", ref: "ECHANGEBJ00001", commercialId: "other" });
const collision = await actions.requestOrderExchange(original.id, payload);
session = admin;
const alternative = await actions.reviewOrderExchange(collision.request.id, "APPROVED");
assert.notEqual(alternative.newOrderRef, "ECHANGEBJ00001", "An existing reprogrammed ref must get a new available ref");

reset();
const gifted = await actions.requestOrderExchange(original.id, { ...payload, total: 0, items: [{ ...payload.items[0], isGift: true, price: 0, originalPrice: 2000 }] });
session = admin;
await actions.reviewOrderExchange(gifted.request.id, "APPROVED");
assert.equal(store.orders[1].items[0].giftApprovalStatus, "PENDING", "Reprogramming approval must not bypass the commercial gift quota");
assert.equal(store.giftRequests.length, 1);
assert.equal(store.messages.find(message => message.body.includes("Demande cadeau")).senderRole, "COMMERCIAL");

reset();
const mine = await actions.requestOrderExchange(original.id, payload);
assert.equal((await actions.getExchangeRequests()).requests.length, 1);
session.id = "other-commercial";
assert.equal((await actions.getExchangeRequests()).requests.length, 0, "Commercial can only read their own requests");
session = { ...admin, role: "developer" };
assert.equal((await actions.reviewOrderExchange(mine.request.id, "APPROVED")).status, "APPROVED");

reset();
session = admin;
const direct = await orders.duplicateOrder(original.id, payload);
assert.equal(direct.order.status, "CONFIRMED", "Admin can still directly reprogram");
assert.equal(store.requests.length, 0);
assert.equal(store.orders.length, 2);

reset();
const ordinary = await orders.createOrder({ ...payload, type: "Standard" });
assert.equal(ordinary.order.status, "CONFIRMED", "Ordinary staff creation is unchanged");
assert.equal(ordinary.order.commercialId, commercial.id);
assert.equal(externalCalls, 2);

reset(); session = null;
const web = await orders.createPublicOrder(payload);
assert.equal(web.success, true, "Public checkout remains usable without a staff session");
assert.equal(web.order.status, "TO_PROCESS");
assert.equal(web.order.commercialId, commercial.id);
assert.equal(externalCalls, 1, "Web TO_PROCESS triggers automations but not confirmed WhatsApp");

reset();
const repro = await orders.reprogramOrder(original.id, { ...payload, type: "Reprogrammé" });
assert.equal(repro.order.type, "Reprogrammé");
assert.equal(store.requests.length, 0, "Commercial reprogramming is direct again");
reset();
const firstExchange = await orders.duplicateOrder(original.id, payload);
session = admin;
await actions.reviewOrderExchange(firstExchange.request.id, "APPROVED");
session = { ...commercial, role: "commercial" };
const secondExchange = await orders.duplicateOrder(original.id, payload);
session = admin;
await actions.reviewOrderExchange(secondExchange.request.id, "APPROVED");
assert.equal(store.orders.length, 3, "A processed exchange does not prevent another exchange request");
assert.notEqual(store.orders[1].ref, store.orders[2].ref);
reset(); session = admin;
const adminRepro = await orders.reprogramOrder(original.id, payload);
assert.equal(adminRepro.order.type, "Reprogrammé");
assert.equal(store.requests.length, 0);
for (const actor of [commercial, admin]) {
  reset(); session = { ...actor, role: actor.role.toLowerCase() };
  const report = await statusActions.updateOrderStatus(original.id, "REPRO_DISPO", "Client absent", undefined, "2099-01-02");
  assert.equal(report.success, true);
  assert.equal(report.approvalRequired, undefined);
  assert.equal(store.orders[0].status, "REPRO_DISPO");
  assert.equal(store.orders[0].stockDecremented, true);
  assert.equal(store.requests.length, 0);
}
reset(); session = admin;
Object.assign(store.orders[0], { createdAt: new Date(), customerPhone: payload.customerPhone, items: structuredClone(payload.items) });
await assert.rejects(() => orders.createOrder({ ...payload, type: "Standard", commune: "Hors Abidjan", paymentMethod: "Orange Money", depositSenderPhone: "0000000000" }), /Expédition refusée/);
const expedition = await orders.duplicateOrder(original.id, { ...payload, commune: "Hors Abidjan", paymentMethod: "Orange Money", depositSenderPhone: "0000000000" });
assert.equal(expedition.order.type, "Echange");
reset();
const expeditionRequest = await orders.duplicateOrder(original.id, { ...payload, commune: "Hors Abidjan", paymentMethod: "Orange Money", depositSenderPhone: "0000000000" });
assert.equal(store.orders.length, 1);
session = admin;
await actions.reviewOrderExchange(expeditionRequest.request.id, "APPROVED");
assert.equal(store.orders.length, 2);
reset(); session = admin;
await assert.rejects(() => orders.duplicateOrder(original.id, { ...payload, commune: "Hors Abidjan" }), /paiement/);
reset();
await assert.rejects(() => actions.requestOrderExchange(original.id, { ...payload, exchangeReason: "" }), /motif/i);
await assert.rejects(() => actions.requestOrderExchange(original.id, { ...payload, commune: "Hors Abidjan" }), /paiement/);
session = { ...admin, role: "packing" };
await assert.rejects(() => orders.duplicateOrder(original.id, payload), /Accès/);
console.log("PASS: commercial exchange pending/approve/refuse, rights, validation, attribution, stale requests, rollback, duplicates, gifts, direct reprogramming and expedition exchanges. Mocked DB only.");

for (const actor of [commercial, admin]) {
  reset(); session = { ...actor, role: actor.role.toLowerCase() };
  Object.assign(store.orders[0], { createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-02T00:00:00Z"), deliveryDate: new Date("2020-01-03T00:00:00Z"),
    status: "DELIVERED", settlementId: "historical-settlement" });
  const result = await orders.duplicateOrder(original.id, payload);
  if (actor.id === commercial.id) {
    assert.equal(result.approvalRequired, true);
    session = admin;
    await actions.reviewOrderExchange(result.request.id, "APPROVED");
  }
  assert.equal(store.orders.length, 2, "An old delivered/settled original can have a new exchange");
  assert.equal(store.orders[0].settlementId, "historical-settlement");
  assert.equal(store.orders[0].status, "DELIVERED");
}
console.log("PASS: old original (2020), past original delivery date, delivered and settled; commercial approval and admin direct exchange remain allowed.");

const facade = load("modules/orders/actions/index.ts", {
  "./actions": orders, "./exchange-actions": actions, "./reprogramming-actions": {},
  "../types/exchange": types, "../helpers/exchange-diagnostics": diagnostics,
});
reset();
const invalidUi = await facade.duplicateOrderForUi(original.id, { ...payload, customerLocation: null });
assert.equal(invalidUi.success, false);
assert.match(invalidUi.error, /Adresse du client/);
assert.equal(store.requests.length, 0);
assert.equal(store.orders.length, 1);
const missingReasonUi = await facade.duplicateOrderForUi(original.id, { ...payload, exchangeReason: "" });
assert.equal(missingReasonUi.success, false);
assert.match(missingReasonUi.error, /Motif/);
const validUi = await facade.duplicateOrderForUi(original.id, payload);
assert.equal(validUi.success, true);
assert.equal(validUi.result.approvalRequired, true);
console.log("PASS: UI facade returns actionable field errors instead of production-redacted exceptions.");

session = admin;
const noReason = await facade.reviewOrderExchangeForUi(validUi.result.request.id, "REJECTED");
assert.equal(noReason.success, false);
assert.match(noReason.error, /motif/);
store.requests[0].data.payload.deliveryDate = "2000-01-01";
const expiredDate = await facade.reviewOrderExchangeForUi(validUi.result.request.id, "APPROVED");
assert.equal(expiredDate.success, false);
assert.match(expiredDate.error, /date de livraison/);
assert.equal(store.orders.length, 1);
assert.equal(store.requests[0].data.status, "PENDING");
const refused = await facade.reviewOrderExchangeForUi(validUi.result.request.id, "REJECTED", "Date à corriger");
assert.equal(refused.success, true);
assert.equal(refused.request.status, "REJECTED");
console.log("PASS: admin UI preserves readable refusal/date errors and leaves failed approvals pending.");

reset();
const repairable = await actions.requestOrderExchange(original.id, payload);
store.requests[0].data.payload.deliveryDate = "2000-01-01";
store.requests[0].data.payload.customerLocation = null;
store.requests.push({ key: "order-exchange:broken", data: { commercialId: commercial.id, payload: null } });
const listing = await actions.getExchangeRequests();
assert.equal(listing.requests.length, 1, "Expired date and missing legacy address remain readable");
assert.equal(listing.invalidCount, 1, "Malformed row is isolated instead of crashing the page");
assert.equal(listing.requests[0].payload.customerLocation, "");
await assert.rejects(() => actions.reviewOrderExchange(repairable.request.id, "APPROVED", "", { deliveryDate: "2099-01-02" }), /Accès/);
session = admin;
const invalidCorrection = await facade.reviewOrderExchangeForUi(repairable.request.id, "APPROVED", "", { deliveryDate: "2099-01-02", customerLocation: "" });
assert.equal(invalidCorrection.success, false);
assert.match(invalidCorrection.error, /Adresse du client/);
assert.equal(store.orders.length, 1);
const injected = await facade.reviewOrderExchangeForUi(repairable.request.id, "APPROVED", "", { total: 1 });
assert.equal(injected.success, false, "Correction endpoint must not accept prices or arbitrary fields");
const repaired = await facade.reviewOrderExchangeForUi(repairable.request.id, "APPROVED", "", { deliveryDate: "2099-01-02", customerLocation: "Adresse de test corrigée" });
assert.equal(repaired.success, true);
assert.equal(repaired.request.correction.previousDeliveryDate, "2000-01-01");
assert.equal(repaired.request.correction.byName, admin.name);
assert.equal(store.orders[1].customerLocation, "Adresse de test corrigée");
assert.equal(store.orders[1].deliveryDate.getFullYear(), 2099);
assert.equal(store.orders[0].deliveryDate.toISOString(), original.deliveryDate.toISOString());
await facade.reviewOrderExchangeForUi(repairable.request.id, "APPROVED", "", { customerLocation: "Autre adresse test" });
assert.equal(store.orders.length, 2, "Repeat approval cannot create another exchange or revise its address");
assert.equal(store.requests[0].data.payload.customerLocation, "Adresse de test corrigée");

reset();
const staleCorrection = await actions.requestOrderExchange(original.id, payload);
store.orders[0].updatedAt = new Date("2026-09-19T00:00:00Z");
session = admin;
const stillStale = await facade.reviewOrderExchangeForUi(staleCorrection.request.id, "APPROVED", "", { deliveryDate: "2099-01-02" });
assert.equal(stillStale.success, false);
assert.match(stillStale.error, /changé/);
assert.equal(store.orders.length, 1);
console.log("PASS: safe archive reading, malformed isolation, audited admin corrections, strict fields, permissions, idempotency and stale original guard.");

reset();
const afterCommit = await actions.requestOrderExchange(original.id, payload);
session = admin;
failWhatsApp = true;
failRevalidation = true;
const logs = [];
const originalConsoleError = console.error;
console.error = (...args) => logs.push(args);
try {
  const committed = await facade.reviewOrderExchangeForUi(afterCommit.request.id, "APPROVED");
  assert.equal(committed.success, true, "Post-commit failures must not report a failed approval");
  assert.equal(externalCalls, 2, "Automation still runs when WhatsApp throws");
  assert.equal(store.orders.length, 2);
  const failingFacade = load("modules/orders/actions/index.ts", {
    "./actions": orders, "./reprogramming-actions": {}, "../types/exchange": types,
    "../helpers/exchange-diagnostics": diagnostics,
    "./exchange-actions": {
      getExchangeRequests: async () => { throw Object.assign(new Error("Private error detail"), { code: "P1001" }); },
      reviewOrderExchange: async () => { throw Object.assign(new Error("Private error detail"), { code: "P2002" }); },
    },
  });
  const failedLoad = await failingFacade.getExchangeRequestsForUi();
  const failedReview = await failingFacade.reviewOrderExchangeForUi(afterCommit.request.id, "APPROVED");
  assert.equal(failedLoad.success, false);
  assert.match(failedLoad.error, /Référence/);
  assert.match(failedReview.error, /Référence/);
  assert.ok(logs.some(([, metadata]) => metadata.code === "P2002" && metadata.stage === "review"));
  assert.ok(!JSON.stringify(logs).includes("Private error detail"), "Diagnostics must not echo exception details");
  assert.ok(!JSON.stringify(logs).includes(payload.customerPhone), "Diagnostics must not contain customer data");
} finally { console.error = originalConsoleError; }
console.log("PASS: committed approvals survive external/cache failures; technical references and Prisma codes do not expose payloads or exception messages.");

const userLookup = database.user.findUnique;
const cases = [
  ["deleted original", () => { store.orders[0].deletedAt = new Date(); }, /supprimée ou archivée/],
  ["missing original", () => { store.orders = []; }, /supprimée ou archivée/],
  ["reassigned", () => { store.orders[0].commercialId = "other"; }, /réattribuée/],
  ["changed", () => { store.orders[0].updatedAt = new Date(); }, /changé/],
  ["missing commercial", () => { database.user.findUnique = async () => null; }, /demandeur a été supprimé/],
  ["changed role", () => { database.user.findUnique = async () => ({ ...commercial, role: "PACKING" }); }, /plus le rôle commercial/],
  ["missing product", () => { store.requests[0].data.payload.items[0].productId = "removed"; }, /Article 1.*produit a été supprimé/],
  ["missing variant", () => { store.requests[0].data.payload.items[0].variantId = "removed"; }, /Article 1.*variante a été supprimée/],
  ["mismatched variant", () => { store.requests[0].data.payload.items[0].productId = undefined; }, /variante ne correspond pas/],
  ["payment method", () => { store.requests[0].data.payload.commune = "Hors Abidjan"; }, /Moyen de paiement/],
  ["payer", () => { Object.assign(store.requests[0].data.payload, { commune: "Hors Abidjan", paymentMethod: "Test" }); }, /Numéro du payeur/],
  ["address", () => { store.requests[0].data.payload.customerLocation = ""; }, /Adresse du client/],
  ["date", () => { store.requests[0].data.payload.deliveryDate = "2000-01-01"; }, /date de livraison/],
  ["quantity", () => { store.requests[0].data.payload.items[0].qty = 0; }, /article 1.*Quantité/],
  ["no permission", () => { session = { ...admin, role: "packing" }; }, /Accès/],
  ["no session", () => { session = null; }, /Accès/],
];
for (const [label, mutate, expected] of cases) {
  reset(); database.user.findUnique = userLookup;
  const request = await actions.requestOrderExchange(original.id, payload);
  session = admin;
  mutate();
  const count = store.orders.length;
  const response = await facade.reviewOrderExchangeForUi(request.request.id, "APPROVED");
  assert.equal(response.success, false, label);
  assert.match(response.error, expected, label);
  assert.equal(store.orders.length, count, `${label}: no exchange created`);
  assert.equal(store.requests[0].data.status, "PENDING", `${label}: remains pending`);
}
database.user.findUnique = userLookup;
reset(); session = admin;
assert.match((await facade.reviewOrderExchangeForUi("bad-id", "APPROVED")).error, /Identifiant/);
assert.match((await facade.reviewOrderExchangeForUi("00000000-0000-4000-8000-000000000001", "APPROVED")).error, /introuvable/);

const technicalCases = { P2002: /unique/, P2003: /liée/, P2025: /supprimée/, P1001: /indisponible/, P1002: /indisponible/, P1008: /indisponible/, P1017: /indisponible/, P2024: /indisponible/, P2028: /transaction/, P2034: /simultanément/, P2021: /structure/, P2022: /structure/, UNKNOWN: /inattendue/ };
for (const [code, expected] of Object.entries(technicalCases)) {
  const message = diagnostics.exchangeTechnicalMessage({ code, message: "private-client-data", meta: { target: "private-client-data" } });
  assert.match(message, expected);
  assert.ok(!message.includes("private-client-data"));
}
console.log("PASS: 16 business failure scenarios, invalid/missing request IDs and 13 technical classifications; failures preserve pending requests and do not create exchanges.");
