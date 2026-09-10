import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fs from "node:fs";
const mode = process.argv[2] || "audit";
if (!["audit", "delete"].includes(mode)) throw new Error("Mode invalide");
const file = "scratch/rider-demo-manifest.json";
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
const ids = manifest.orders.map(o => o.id);
if (manifest.database !== "zangochapdb" || ids.length !== 12 || new Set(ids).size !== 12) throw new Error("Manifeste inattendu");
const connectionString = process.env.DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== "/zangochapdb") throw new Error("Base inattendue");
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function audit(db) {
  const orders = await db.order.findMany({ where: { id: { in: ids } }, include: { items: true }, orderBy: { id: "asc" } });
  const links = {};
  for (const model of ["stockMovement", "giftApprovalRequest", "collectionRecord", "promoUsage"]) links[model] = await db[model].count({ where: { orderId: { in: ids } } });
  const unsafe = orders.filter(o => o.ref !== manifest.orders.find(m => m.id === o.id)?.ref || o.notes !== "DONNEES DE TEST RIDER - AUCUNE LIVRAISON REELLE" || o.deliverymanId !== manifest.riderId || o.stockDecremented || o.settlementId || o.customerId || o.promoCode || o.items.some(i => i.productId || i.variantId || !i.isCustom));
  return { orders, links, unsafe: unsafe.length };
}
try {
  const before = await audit(prisma);
  console.log(JSON.stringify({ database: "zangochapdb", orders: before.orders.length, items: before.orders.reduce((n,o) => n + o.items.length, 0), links: before.links, unsafe: before.unsafe }));
  if (mode === "delete") {
    if (before.unsafe || Object.values(before.links).some(Boolean)) throw new Error("Liens métier détectés : suppression refusée");
    if (!before.orders.length) { console.log("Aucune commande restante"); }
    else {
      const backup = "scratch/rider-demo-backup-" + Date.now() + ".json";
      fs.writeFileSync(backup, JSON.stringify({ manifest, ...before }, null, 2), { flag: "wx" });
      const deleted = await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Order" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`);
        const current = await audit(tx);
        if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error("Le lot a changé depuis la sauvegarde");
        const result = await tx.order.deleteMany({ where: { id: { in: ids }, notes: "DONNEES DE TEST RIDER - AUCUNE LIVRAISON REELLE", deliverymanId: manifest.riderId } });
        if (result.count !== before.orders.length) throw new Error("Nombre de suppressions inattendu");
        return result.count;
      }, { isolationLevel: "Serializable", timeout: 30000 });
      const remaining = await prisma.order.count({ where: { id: { in: ids } } });
      const remainingItems = await prisma.orderItem.count({ where: { orderId: { in: ids } } });
      manifest.state = "deleted"; manifest.deletedAt = new Date().toISOString(); manifest.backup = backup;
      fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
      console.log(JSON.stringify({ deleted, remaining, remainingItems, backup }));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[connexion masquée]") : "Erreur");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); await pool.end(); }
