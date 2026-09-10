import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const mode = process.argv[2] || "audit";
const email = process.argv[3];
if (!email || !["audit", "insert"].includes(mode)) throw new Error("Usage: node scripts/rider-demo.mjs audit|insert email");
const connectionString = process.env.DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/zangochapdb") throw new Error("Base non autorisée : zangochapdb attendue.");
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const fixtures = JSON.parse(fs.readFileSync("scripts/fixtures/rider-demo.json", "utf8"));
const refs = fixtures.map(f => f.ref);
const manifestPath = path.resolve("scratch/rider-demo-manifest.json");
const marker = "DONNEES DE TEST RIDER - AUCUNE LIVRAISON REELLE";
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, name: true } });
  const existing = await prisma.order.findMany({ where: { ref: { in: refs } }, select: { id: true, ref: true, deliverymanId: true, notes: true } });
  if (mode === "audit") {
    console.log(JSON.stringify({ database: "zangochapdb", accountFound: !!user, role: user?.role, matchingTestOrders: existing.length, foreignReferences: existing.filter(o => o.deliverymanId !== user?.id || o.notes !== marker).length }));
  } else {
    if (!user || user.role !== "LIVREUR") throw new Error("Compte livreur existant requis. Aucun compte modifié.");
    if (existing.length) throw new Error("Références déjà présentes : insertion refusée pour éviter les doublons.");
    if (fs.existsSync(manifestPath)) throw new Error("Un manifeste de test existe déjà : le conserver et vérifier avant de continuer.");
    const now = new Date();
    const batchId = crypto.randomUUID();
    const atDay = offset => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + offset);
      d.setUTCHours(12, 0, 0, 0);
      if (offset === 0 && d > now) return now;
      return d;
    };
    const manifest = {
      batchId, database: "zangochapdb", riderId: user.id, createdAt: now.toISOString(),
      state: "prepared", orders: fixtures.map(f => ({ id: crypto.randomUUID(), ref: f.ref })),
      cleanup: "Supprimer uniquement les IDs de ce manifeste après contrôle des liens comptables et des mouvements de stock.",
    };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    try {
      await prisma.$transaction(async tx => {
        for (let i = 0; i < fixtures.length; i++) {
          const f = fixtures[i];
          const event = atDay(f.eventDayOffset);
          const success = ["DELIVERED", "PARTIALLY_DELIVERED"].includes(f.status);
          const issue = ["RETURNED", "REPRO_DISPO"].includes(f.status);
          const createdAt = atDay(Math.min(f.eventDayOffset, f.deliveryDayOffset, 0) - 1);
          const items = f.items.map(item => ({ ...item }));
          if (f.status === "PARTIALLY_DELIVERED") items.push({ name: "Article fictif refusé", size: "Test", color: "Test", qty: 1, price: 6000, isCustom: true, isGift: false, isDelivered: false, packingStatus: "PACKED" });
          await tx.order.create({ data: {
            id: manifest.orders[i].id, ref: f.ref, status: f.status,
            customerName: f.customerName, customerPhone: f.customerPhone,
            customerLocation: f.customerLocation, commune: f.commune,
            total: f.total, deliveryFee: f.deliveryFee, amountReceived: f.amountReceived,
            notes: marker, deliveryNote: "TEST : ne pas contacter de client et ne pas effectuer de livraison réelle.",
            deliverymanId: user.id, deliverymanName: user.name,
            deliveryDate: atDay(f.deliveryDayOffset), createdAt, updatedAt: event,
            confirmedAt: createdAt, packedAt: createdAt,
            stockDecremented: false, isLabeled: true,
            deliveredAt: success ? event.toISOString() : null,
            ...(issue ? {
              lastDeliveryAttemptAt: event, lastDeliveryAttemptRiderId: user.id,
              lastDeliveryAttemptRiderName: user.name, lastDeliveryAttemptStatus: f.status,
              lastDeliveryAttemptReason: "Scénario de test", returnReason: "Scénario de test",
            } : {}),
            history: [{ at: now.toISOString(), action: "Création de démonstration autorisée", batchId }],
            items: { create: items },
          } });
        }
      }, { timeout: 60000 });
      manifest.state = "inserted";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(JSON.stringify({ inserted: fixtures.length, manifest: "scratch/rider-demo-manifest.json", statuses: fixtures.reduce((a, f) => { a[f.status] = (a[f.status] || 0) + 1; return a; }, {}) }));
    } catch (error) {
      console.error("Insertion non confirmée : conserver le manifeste pour vérifier les IDs avant tout nouvel essai.");
      throw error;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[connexion masquée]") : "Erreur");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await pool.end();
}
