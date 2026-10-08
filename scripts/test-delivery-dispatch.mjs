// Tests isoles de la repartition automatique des livraisons :
// moteur pur + actions serveur avec Prisma simule. Aucune base, aucun reseau.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function load(path, modules = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const scope = { exports: {}, console, Date, Map, Set, Math, JSON, Number, String, Array, Object, Error, Promise, Infinity };
  scope.module = { exports: scope.exports };
  scope.require = (name) => {
    if (name in modules) return modules[name];
    if (name.startsWith("@/") || name.startsWith(".")) throw new Error(`module non simule : ${name}`);
    return require(name);
  };
  vm.runInNewContext(compiled, scope, { filename: path });
  return scope.exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

const constants = load("lib/constants.ts");
const engine = load("modules/orders/helpers/delivery-dispatch.ts", { "@/lib/constants": constants });
const planningTypes = load("modules/delivery-planning/types/index.ts", { "@/lib/constants": constants });
const { getRiderAvailability, parseDeliveryPlanning, RiderPlanningSchema } = planningTypes;

// ---------- Planning ----------
const week = { inDispatch: true, workDays: [1, 2, 3, 4, 5, 6], absences: [], fixedCommunes: [], capacity: null };
assert.equal(getRiderAvailability(undefined, "2026-10-06", true).present, true);
assert.equal(getRiderAvailability(undefined, "2026-10-06", false).present, false);
assert.equal(getRiderAvailability(week, "2026-10-06", false).present, true, "planning prioritaire sur l'inactivite"); // mardi
assert.equal(getRiderAvailability(week, "2026-10-11", true).reason, "Jour de repos"); // dimanche
assert.equal(getRiderAvailability({ ...week, inDispatch: false }, "2026-10-06", true).reason, "Hors repartition");
const away = { ...week, absences: [{ id: "a", from: "2026-10-05", to: "2026-10-07", reason: "Conge" }] };
assert.equal(getRiderAvailability(away, "2026-10-07", true).reason, "Absent : Conge");
assert.equal(getRiderAvailability(away, "2026-10-08", true).present, true);
assert.throws(() => RiderPlanningSchema.parse({ ...week, absences: [{ id: "a", from: "2026-10-09", to: "2026-10-01", reason: "" }] }));
assert.throws(() => RiderPlanningSchema.parse({ ...week, fixedCommunes: ["Mars"] }));
assert.throws(() => RiderPlanningSchema.parse({ ...week, capacity: 0 }));
assert.deepEqual(plain(RiderPlanningSchema.parse({ ...week, workDays: [6, 1, 1] }).workDays), [1, 6]);
// JSON stocke corrompu : entree ignoree, jamais bloquante.
assert.deepEqual(Object.keys(parseDeliveryPlanning({ riders: { ok: week, bad: { workDays: "x" } } }).riders), ["ok"]);
assert.deepEqual(plain(parseDeliveryPlanning(null)), { riders: {}, settings: { autoAssignOnConfirm: false } });
assert.equal(parseDeliveryPlanning({ settings: { autoAssignOnConfirm: "oui" } }).settings.autoAssignOnConfirm, false, "seul true active");
assert.equal(parseDeliveryPlanning({ settings: { autoAssignOnConfirm: true } }).settings.autoAssignOnConfirm, true);
const { planDeliveryDispatch, normalizeCommune, getDispatchIneligibility } = engine;

// ---------- Moteur ----------
assert.equal(normalizeCommune("yopougon"), "Yopougon");
assert.equal(normalizeCommune(" Port bouet "), "Port-Bouët");
assert.equal(normalizeCommune("PORT-BOUËT"), "Port-Bouët");
assert.equal(normalizeCommune("Ville inconnue"), null);
assert.equal(normalizeCommune(""), null);

const base = {
  id: "o", ref: "R", status: "PACKED", commune: "Cocody", customerPhone: "0700000000", customerLocation: "Riviera",
  deliverymanId: null, settlementId: null, depositVerificationStatus: null,
};
const order = (id, extra = {}) => ({ ...base, id, ref: id, ...extra });

assert.equal(getDispatchIneligibility(order("a")), null);
assert.match(getDispatchIneligibility(order("a", { status: "CONFIRMED" })), /Pas prete/);
assert.equal(getDispatchIneligibility(order("a", { deliverymanId: "r1" })), "Deja attribuee");
assert.equal(getDispatchIneligibility(order("a", { status: "REPRO_DISPO", deliverymanId: "r1" })), null);
assert.equal(getDispatchIneligibility(order("a", { settlementId: "s" })), "Deja rattachee a un reglement");
assert.equal(getDispatchIneligibility(order("a", { customerPhone: " " })), "Telephone manquant");
// Adresse absente : livrable (le livreur appelle le client), signalee dans l apercu.
assert.equal(getDispatchIneligibility(order("a", { customerLocation: "" })), null);
assert.equal(getDispatchIneligibility(order("a", { commune: "Boutique", customerLocation: "" })), null);
assert.equal(getDispatchIneligibility(order("a", { commune: "Hors Abidjan", depositVerificationStatus: "PENDING" })), "Depot expedition non valide");
assert.equal(getDispatchIneligibility(order("a", { commune: "Hors Abidjan", depositVerificationStatus: "RECEIVED" })), null);
assert.match(getDispatchIneligibility(order("a", { commune: "Mars" })), /Commune inconnue/);

const riders = [
  { id: "cocody", name: "A Cocody" },
  { id: "yop", name: "B Yopougon" },
  { id: "exp", name: "C Expeditions" },
  { id: "old", name: "D Ancien" },
];
const history = {
  cocody: { Cocody: 76, Bingerville: 20 },
  yop: { Yopougon: 70, Songon: 20 },
  exp: { "Hors Abidjan": 100 },
};
const plan = (orders, extra = {}) => planDeliveryDispatch({
  orders, riders, presentRiderIds: ["cocody", "yop", "exp"], capacity: 18,
  currentLoads: {}, currentCommunes: {}, history, ...extra,
});
const riderOf = (result, id) => result.assignments.find((a) => a.orderId === id)?.riderId;

// Zones habituelles respectees, absent jamais choisi.
let result = plan([order("c1"), order("y1", { commune: "yopougon" }), order("e1", { commune: "Hors Abidjan" }), order("b1", { commune: "Bingerville" })]);
assert.equal(riderOf(result, "c1"), "cocody");
assert.equal(riderOf(result, "y1"), "yop");
assert.equal(riderOf(result, "e1"), "exp");
assert.equal(riderOf(result, "b1"), "cocody");
assert.ok(result.assignments.every((a) => a.riderId !== "old"));
assert.ok(result.assignments.every((a) => a.reason === "zone"));

// Plafond : le surplus part chez les autres, puis est signale quand tout est plein.
const many = Array.from({ length: 30 }, (_, i) => order(`c${String(i).padStart(2, "0")}`));
result = plan(many, { capacity: 10 });
const count = (r, id) => r.assignments.filter((a) => a.riderId === id).length;
assert.equal(count(result, "cocody"), 10);
assert.equal(count(result, "yop") + count(result, "exp"), 20);
assert.equal(result.skipped.length, 0);
result = plan(many, { capacity: 5 });
assert.equal(result.assignments.length, 15);
assert.equal(result.skipped.length, 15);
assert.ok(result.skipped.every((s) => s.reason === "Plafond atteint pour tous les livreurs presents"));

// La charge deja attribuee pour la date compte dans le plafond.
result = plan([order("c1"), order("c2")], { capacity: 18, currentLoads: { cocody: 17, yop: 17, exp: 17 } });
assert.equal(count(result, "cocody"), 1);
assert.equal(result.loads.cocody.before, 17);
assert.equal(result.loads.cocody.after, 18);

// Repro-dispo : meme livreur s'il est present, sinon redistribuee.
result = plan([order("r1", { status: "REPRO_DISPO", deliverymanId: "yop", commune: "Cocody" })]);
assert.deepEqual(plain(result.assignments[0]), { orderId: "r1", riderId: "yop", reason: "repro" });
result = plan([order("r2", { status: "REPRO_DISPO", deliverymanId: "old", commune: "Cocody" })]);
assert.equal(riderOf(result, "r2"), "cocody");

// Equilibrage : un livreur deja tres charge cede le surplus aux autres presents.
result = plan([order("c1"), order("c2")], { currentLoads: { cocody: 15 } });
assert.equal(count(result, "cocody"), 0);

// Commune sans historique : equilibrage par la charge (reason "charge").
result = plan([order("p1", { commune: "Plateau" })], { currentLoads: { cocody: 5, yop: 1, exp: 3 } });
assert.equal(riderOf(result, "p1"), "yop");
assert.equal(result.assignments[0].reason, "charge");

// Aucun present : tout est signale, rien n'est attribue.
result = plan([order("c1")], { presentRiderIds: [] });
assert.equal(result.assignments.length, 0);
assert.equal(result.skipped[0].reason, "Aucun livreur present");

// Zone fixe du planning : prioritaire sur l'historique.
result = plan([order("x1", { commune: "Cocody" })], { fixedCommunes: { yop: ["Cocody"] } });
assert.deepEqual(plain(result.assignments[0]), { orderId: "x1", riderId: "yop", reason: "fixed" });
// Plafond individuel : remplace le plafond general pour ce livreur.
result = plan(many, { capacity: 20, capacities: { cocody: 3 } });
assert.equal(count(result, "cocody"), 3);

// Commune affectee a plusieurs livreurs : parts egales (15 -> 5/5/5, 16 -> 6/5/5), quelle que soit la commune.
const koumassi = (n) => Array.from({ length: n }, (_, i) => order(`k${String(i).padStart(2, "0")}`, { commune: "Koumassi" }));
const trio = { cocody: ["Koumassi"], yop: ["Koumassi"], exp: ["Koumassi"] };
result = plan(koumassi(15), { fixedCommunes: trio });
assert.deepEqual([count(result, "cocody"), count(result, "yop"), count(result, "exp")], [5, 5, 5]);
assert.ok(result.assignments.every((a) => a.reason === "fixed"));
result = plan(koumassi(16), { fixedCommunes: trio });
assert.deepEqual([count(result, "cocody"), count(result, "yop"), count(result, "exp")].sort(), [5, 5, 6]);
// Parts egales DANS la commune, meme si un livreur a deja des colis ailleurs (option a).
result = plan(koumassi(15), { fixedCommunes: trio, currentLoads: { cocody: 8 }, currentCommunes: { cocody: Array(8).fill("Marcory") } });
assert.deepEqual([count(result, "cocody"), count(result, "yop"), count(result, "exp")], [5, 5, 5]);
// Ce qui est deja attribue dans la commune ce jour-la compte dans le partage.
result = plan(koumassi(12), { fixedCommunes: trio, currentLoads: { cocody: 3 }, currentCommunes: { cocody: ["Koumassi", "Koumassi", "Koumassi"] } });
assert.deepEqual([3 + count(result, "cocody"), count(result, "yop"), count(result, "exp")], [5, 5, 5]);
// Un affecte absent : les presents se partagent ; plafond respecte.
result = plan(koumassi(10), { fixedCommunes: { ...trio, old: ["Koumassi"] } });
assert.equal(count(result, "old"), 0);
assert.equal(count(result, "cocody") + count(result, "yop") + count(result, "exp"), 10);
result = plan(koumassi(15), { fixedCommunes: trio, capacities: { cocody: 2 } });
assert.equal(count(result, "cocody"), 2);
assert.deepEqual([count(result, "yop"), count(result, "exp")].sort(), [6, 7]);

// Hors Abidjan : jamais envoye au hasard a un livreur d'Abidjan.
const exped = (n) => Array.from({ length: n }, (_, i) => order(`e${i}`, { commune: "Hors Abidjan", depositVerificationStatus: "RECEIVED" }));
result = plan(exped(4), { fixedCommunes: { exp: ["Hors Abidjan"] } });
assert.equal(count(result, "exp"), 4);
// Affecte absent : non reparti, raison explicite, l'admin choisit.
result = plan(exped(2), { fixedCommunes: { exp: ["Hors Abidjan"] }, presentRiderIds: ["cocody", "yop"] });
assert.equal(result.assignments.length, 0);
assert.match(result.skipped[0].reason, /affecte\(s\) a Hors Abidjan absent/);
// Sans affectation : seulement un livreur habituel des expeditions, sinon non reparti.
result = plan(exped(2), { presentRiderIds: ["cocody", "yop"] });
assert.equal(result.assignments.length, 0);
assert.match(result.skipped[0].reason, /Aucun livreur habituel de Hors Abidjan/);
result = plan(exped(2));
assert.equal(count(result, "exp"), 2);
// Changement durable du destinataire : nouvel affecte dans le planning.
result = plan(exped(3), { fixedCommunes: { yop: ["Hors Abidjan"] } });
assert.equal(count(result, "yop"), 3);

// Determinisme : meme entree => meme plan, quel que soit l'ordre d'arrivee.
const shuffled = [...many].reverse();
assert.deepEqual(plain(plan(many, { capacity: 12 })), plain(plan(shuffled, { capacity: 12 })));

// ---------- Actions serveur (Prisma simule) ----------
let session;
let store;
let automationCalls;
let stockCalls;
let concurrentTx;
let maxConcurrentTx;
const at = (iso) => new Date(iso);

function reset() {
  session = { id: "admin", email: "admin@example.test", name: "Admin", role: "admin" };
  automationCalls = 0; stockCalls = 0; concurrentTx = 0; maxConcurrentTx = 0;
  store = {
    users: [
      { id: "cocody", name: "A Cocody", role: "LIVREUR" },
      { id: "yop", name: "B Yopougon", role: "LIVREUR" },
      { id: "old", name: "D Ancien", role: "LIVREUR" },
      { id: "com", name: "Commercial", role: "COMMERCIAL" },
    ],
    planning: { riders: {} },
    orders: [
      { ...order("o1"), deliveryDate: at("2026-10-06T00:00:00Z"), updatedAt: at("2026-10-05T10:00:00Z"), history: [], items: [], stockDecremented: true, deletedAt: null, total: 10000, deliveryFee: 1500, discount: 0, customerName: "Client 1", deliverymanName: null },
      { ...order("o2", { commune: "Yopougon" }), deliveryDate: at("2026-10-06T00:00:00Z"), updatedAt: at("2026-10-05T10:00:00Z"), history: [], items: [], stockDecremented: true, deletedAt: null, total: 5000, deliveryFee: 1500, discount: 0, customerName: "Client 2", deliverymanName: null },
      { ...order("o3", { status: "CONFIRMED" }), deliveryDate: at("2026-10-06T00:00:00Z"), updatedAt: at("2026-10-05T10:00:00Z"), history: [], items: [], stockDecremented: false, deletedAt: null, total: 1, deliveryFee: 0, discount: 0, customerName: "Client 3", deliverymanName: null },
    ],
  };
}

const matches = (row, where = {}) => Object.entries(where).every(([key, cond]) => {
  if (key === "OR") return cond.some((c) => matches(row, c));
  const value = row[key];
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    if ("in" in cond) return cond.in.includes(value);
    if ("not" in cond) return cond.not === null ? value != null : value !== cond.not;
    if ("gte" in cond || "lt" in cond) return (!cond.gte || value >= cond.gte) && (!cond.lt || value < cond.lt);
  }
  if (cond instanceof Date) return value?.getTime() === cond.getTime();
  return value === cond;
});

const database = {
  user: { findMany: async ({ where }) => structuredClone(store.users.filter((u) => matches(u, where))) },
  order: {
    findMany: async ({ where }) => structuredClone(store.orders.filter((o) => matches(o, where))),
    findUnique: async ({ where }) => structuredClone(store.orders.find((o) => o.id === where.id) || null),
    groupBy: async () => [
      { deliverymanId: "cocody", commune: "Cocody", _count: { _all: 40 }, _max: { deliveryDate: at("2026-10-05T00:00:00Z") } },
      { deliverymanId: "yop", commune: "yopougon", _count: { _all: 40 }, _max: { deliveryDate: at("2026-10-04T00:00:00Z") } },
      { deliverymanId: "old", commune: "Cocody", _count: { _all: 90 }, _max: { deliveryDate: at("2026-09-10T00:00:00Z") } },
    ],
    updateMany: async ({ where, data }) => {
      const row = store.orders.find((o) => matches(o, where));
      if (!row) return { count: 0 };
      Object.assign(row, structuredClone(data), { updatedAt: new Date() });
      return { count: 1 };
    },
  },
  $transaction: async (fn) => {
    concurrentTx++; maxConcurrentTx = Math.max(maxConcurrentTx, concurrentTx);
    const snapshot = structuredClone(store.orders);
    try { return await fn(database); }
    catch (error) { store.orders = snapshot; throw error; }
    finally { await new Promise((r) => setTimeout(r, 1)); concurrentTx--; }
  },
};

const planningLoad = { loadDeliveryPlanning: async () => ({ settings: { autoAssignOnConfirm: false }, ...structuredClone(store.planning) }) };
const dispatchContext = load("modules/orders/actions/dispatch-context.ts", {
  "@/modules/delivery-planning/helpers/load": planningLoad,
  "@/modules/delivery-planning/types": planningTypes,
  "../helpers/delivery-dispatch": engine,
});
const actions = load("modules/orders/actions/delivery-actions.ts", {
  "@/lib/prisma": { __esModule: true, default: database },
  "next/cache": { revalidatePath: () => {} },
  "@/modules/auth/actions": { getSession: async () => session },
  "../helpers": { isRole: (s, ...roles) => roles.includes(String(s.role).toLowerCase()) },
  "./stock": { decrementStockForOrder: async () => { stockCalls++; } },
  "@/modules/automations/engine": { triggerAutomations: async () => { automationCalls++; } },
  "../helpers/delivery-dispatch": engine,
  "./dispatch-context": dispatchContext,
});

reset();
const proposal = await actions.getDeliveryDispatchPlan({ date: "2026-10-06" });

// Planning : un ancien livreur reprogramme redevient present, un actif en conge est retire.
store.planning = { riders: {
  old: { ...week, fixedCommunes: ["Yopougon"] },
  yop: { ...week, absences: [{ id: "c", from: "2026-10-06", to: "2026-10-06", reason: "Conge" }] },
} };
const planned = await actions.getDeliveryDispatchPlan({ date: "2026-10-06" });
assert.deepEqual(plain(planned.riders).filter((r) => r.present).map((r) => r.id).sort(), ["cocody", "old"]);
assert.equal(planned.riders.find((r) => r.id === "yop").presenceReason, "Absent : Conge");
assert.equal(planned.assignments.find((a) => a.id === "o2").riderId, "old");
assert.equal(planned.assignments.find((a) => a.id === "o2").reason, "fixed");
store.planning = { riders: {} };
assert.deepEqual(plain(proposal.riders).filter((r) => r.present).map((r) => r.id).sort(), ["cocody", "yop"], "ancien livreur absent par defaut");
assert.equal(proposal.assignments.find((a) => a.id === "o1").riderId, "cocody");
assert.equal(proposal.assignments.find((a) => a.id === "o2").riderId, "yop", "commune mal orthographiee normalisee dans l'historique");
assert.match(proposal.skipped.find((s) => s.id === "o3").reason, /Pas prete/);
assert.equal(proposal.assignments.find((a) => a.id === "o1").amount, 11500);

// Les livreurs choisis a la main remplacent la presence par defaut.
const forced = await actions.getDeliveryDispatchPlan({ date: "2026-10-06", presentRiderIds: ["old", "inconnu"] });
assert.ok(forced.assignments.every((a) => a.riderId === "old"));

await assert.rejects(actions.getDeliveryDispatchPlan({ date: "06/10/2026" }), /date/i);
session = { ...session, role: "commercial" };
await assert.rejects(actions.getDeliveryDispatchPlan({ date: "2026-10-06" }), /Acces refuse/);
await assert.rejects(actions.applyDeliveryDispatchPlan([{ orderId: "o1", riderId: "cocody", version: "x" }]), /Acces refuse/);

// Application : succes, version perimee, livreur non valide, commande devenue inelegible.
reset();
const v = "2026-10-05T10:00:00.000Z";
store.orders[1].updatedAt = at("2026-10-05T11:00:00Z"); // o2 modifiee apres l'apercu
const applied = await actions.applyDeliveryDispatchPlan([
  { orderId: "o1", riderId: "cocody", version: v },
  { orderId: "o2", riderId: "yop", version: v },
  { orderId: "o3", riderId: "cocody", version: v },
  { orderId: "o1", riderId: "yop", version: v }, // doublon ignore
]);
assert.equal(applied.assignedCount, 1);
assert.deepEqual(plain(applied.skipped).map((s) => [s.orderId, s.reason]), [
  ["o2", "Modifiee depuis l'apercu"],
  ["o3", "Pas prete a livrer (statut CONFIRMED)"],
]);
const o1 = store.orders.find((o) => o.id === "o1");
assert.equal(o1.deliverymanId, "cocody");
assert.equal(o1.status, "ON_DELIVERY");
assert.match(o1.history.at(-1).action, /Repartition automatique/);
assert.equal(automationCalls, 1);
assert.equal(maxConcurrentTx, 1, "ecritures sequentielles");
assert.equal(store.orders.find((o) => o.id === "o2").deliverymanId, null);

reset();
const badRider = await actions.applyDeliveryDispatchPlan([{ orderId: "o1", riderId: "com", version: v }]);
assert.equal(badRider.assignedCount, 0);
assert.match(badRider.skipped[0].reason, /n'est plus livreur/);

// Concurrence : la ligne change entre la lecture et l'ecriture -> rollback, pas d'ecrasement.
reset();
const originalFind = database.order.findUnique;
database.order.findUnique = async (args) => {
  const row = await originalFind(args);
  store.orders.find((o) => o.id === args.where.id).deliverymanId = "yop"; // attribution concurrente
  return row;
};
const raced = await actions.applyDeliveryDispatchPlan([{ orderId: "o1", riderId: "cocody", version: v }]);
database.order.findUnique = originalFind;
assert.equal(raced.assignedCount, 0);
assert.equal(raced.skipped[0].reason, "Modifiee pendant l'attribution");
assert.notEqual(store.orders.find((o) => o.id === "o1").deliverymanId, "cocody", "aucune ecriture de notre attribution");
assert.equal(automationCalls, 0);

// Compatibilite : ancienne action basee sur le meme moteur.
reset();
const legacy = await actions.autoAssignDeliveryOrders(["o1", "o2", "o3"], "2026-10-06");
assert.equal(legacy.assignedCount, 2);
assert.equal(legacy.skippedCount, 1);

assert.equal(stockCalls, 0, "stock deja decremente a l emballage : pas de double sortie");

// Stock pas encore sorti : decremente une seule fois, dans la transaction d attribution.
reset();
store.orders[0].stockDecremented = false;
await actions.applyDeliveryDispatchPlan([{ orderId: "o1", riderId: "cocody", version: v }]);
assert.equal(stockCalls, 1);

// ---------- Attribution a la validation call center ----------
database.$queryRaw = async () => [{ locked: 1 }];
const autoAssign = load("modules/orders/actions/auto-assign-on-confirm.ts", {
  "@/lib/prisma": { __esModule: true, default: database },
  "@/modules/delivery-planning/helpers/load": planningLoad,
  "../helpers/delivery-dispatch": engine,
  "./dispatch-context": dispatchContext,
});
const confirmed = (id, extra = {}) => ({
  ...order(id, { status: "CONFIRMED", commune: "Koumassi" }), deliveryDate: at("2026-10-06T00:00:00Z"),
  updatedAt: at("2026-10-05T09:00:00Z"), history: [], items: [], stockDecremented: false, deletedAt: null,
  total: 1000, deliveryFee: 0, discount: 0, customerName: "Client", deliverymanName: null, ...extra,
});
const actor = { email: "call@example.test", name: "Call center" };

// Interrupteur coupe (defaut) : aucune ecriture.
reset();
store.orders = [confirmed("v1")];
let auto = await autoAssign.autoAssignAtConfirmation("v1", actor);
assert.deepEqual(plain(auto), { assigned: false, reason: "Desactivee" });
assert.equal(store.orders[0].deliverymanId, null);

// Interrupteur actif : partage egal entre affectes, au fil des validations.
reset();
store.planning = { riders: { cocody: { ...week, fixedCommunes: ["Koumassi"] }, yop: { ...week, fixedCommunes: ["Koumassi"] } }, settings: { autoAssignOnConfirm: true } };
store.orders = ["v1", "v2", "v3", "v4"].map((id) => confirmed(id));
for (const id of ["v1", "v2", "v3", "v4"]) {
  auto = await autoAssign.autoAssignAtConfirmation(id, actor);
  assert.equal(auto.assigned, true);
}
const by = (rider) => store.orders.filter((o) => o.deliverymanId === rider).length;
assert.deepEqual([by("cocody"), by("yop")], [2, 2], "2 livreurs affectes, 4 validations -> 2/2");
const v1 = store.orders.find((o) => o.id === "v1");
assert.equal(v1.status, "CONFIRMED", "statut inchange : le livreur ne la voit qu'une fois emballee");
assert.match(v1.history.at(-1).action, /Attribution automatique a la validation/);
assert.equal(v1.history.at(-1).byName, "Call center");
assert.equal(stockCalls, 0, "aucune sortie de stock a la validation");

// Deja attribuee, sans date, pas CONFIRMED : rien n'est touche.
auto = await autoAssign.autoAssignAtConfirmation("v1", actor);
assert.equal(auto.reason, "Deja attribuee");
store.orders.push(confirmed("nodate", { deliveryDate: null }), confirmed("packed", { status: "PACKED" }));
assert.equal((await autoAssign.autoAssignAtConfirmation("nodate", actor)).reason, "Sans date de livraison");
assert.equal((await autoAssign.autoAssignAtConfirmation("packed", actor)).reason, "Statut PACKED");

// Hors Abidjan avec depot en attente : attribue d'avance au livreur des expeditions.
store.planning.riders.yop.fixedCommunes = ["Hors Abidjan"];
store.orders.push(confirmed("exp1", { commune: "Hors Abidjan", depositVerificationStatus: "PENDING" }));
auto = await autoAssign.autoAssignAtConfirmation("exp1", actor);
assert.equal(auto.assigned && auto.riderId, "yop");

// Conflit : la commande change entre lecture et ecriture -> rien d'ecrit.
store.orders.push(confirmed("race"));
const findBefore = database.order.findUnique;
database.order.findUnique = async (args) => {
  const row = await findBefore(args);
  store.orders.find((o) => o.id === "race").updatedAt = new Date();
  return row;
};
auto = await autoAssign.autoAssignAtConfirmation("race", actor);
database.order.findUnique = findBefore;
assert.equal(auto.reason, "Modifiee pendant l'attribution");
assert.equal(store.orders.find((o) => o.id === "race").deliverymanId, null);

// Panne : jamais d'exception vers la vente.
const brokenGroupBy = database.order.groupBy;
database.order.groupBy = async () => { throw new Error("db down"); };
store.orders.push(confirmed("down"));
auto = await autoAssign.autoAssignAtConfirmation("down", actor);
database.order.groupBy = brokenGroupBy;
assert.deepEqual(plain(auto), { assigned: false, reason: "Erreur" });

console.log("OK: moteur (zones, plafond, charge, repro, absents, determinisme) et actions (droits, presence, version, concurrence, sequentiel, compatibilite).");
console.log("OK: attribution a la validation (interrupteur, partage egal, statut inchange, sans stock, cas ignores, expedition, conflit, panne).");
