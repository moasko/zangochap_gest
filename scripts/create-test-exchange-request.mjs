// Explicitly invoked fixture creation only. No real order, stock, customer or user is modified.
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const value = key => args.find(arg => arg.startsWith(`${key}=`))?.slice(key.length + 1);
const email = value("--email");
if (!email) throw new Error("Argument --email requis.");
const delivery = new Date();
delivery.setUTCDate(delivery.getUTCDate() + 7);
const deliveryDate = delivery.toISOString().slice(0, 10);
const payload = {
  customerName: "CLIENT FICTIF — TEST ÉCHANGE", customerPhone: "0000000000",
  customerLocation: "Adresse fictive — ne pas livrer", commune: "Cocody",
  deliveryFee: 0, total: 1000, discount: 0, deliveryDate,
  exchangeReason: "TEST UNIQUEMENT — changement de taille M vers L",
  notes: "DONNÉES DE TEST — aucune livraison ni encaissement à effectuer.",
  isPaid: false,
  items: [{ name: "ARTICLE FICTIF — TEST", size: "L", color: "Noir", qty: 1, price: 1000 }],
};
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ mode: "preview-no-database", creates: ["1 commande originale fictive", "1 demande EXCHANGE PENDING", "1 message ADMIN"], payload }, null, 2));
} else {
  const environment = value("--environment");
  const envFile = value("--env-file");
  if (!["test", "production"].includes(environment) || !envFile) {
    throw new Error("Cible explicite requise : --environment=test|production et --env-file=chemin.");
  }
  dotenv.config({ path: envFile, quiet: true, override: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquante.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { email }, select: { id: true, name: true, role: true } });
      if (!user || user.role !== "COMMERCIAL") throw new Error("Compte commercial introuvable ou rôle incorrect.");
      const fixtureKey = `test-exchange-fixture:${user.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fixtureKey}))`;
      const previous = await tx.cmsContent.findUnique({ where: { key: fixtureKey } });
      if (previous) return { alreadyCreated: true, ...previous.data };
      const id = randomUUID();
      const ref = `TEST-ECHANGE-${id.slice(0, 8).toUpperCase()}`;
      const original = await tx.order.create({ data: {
        ref, customerName: payload.customerName, customerPhone: payload.customerPhone,
        customerLocation: payload.customerLocation, commune: payload.commune,
        total: payload.total, deliveryFee: 0, type: "Standard", status: "CONFIRMED",
        commercialId: user.id, commercialName: user.name, notes: payload.notes,
        deliveryDate: new Date(`${deliveryDate}T00:00:00Z`),
        items: { create: [{ ...payload.items[0], size: "M" }] }, history: [],
      } });
      const request = {
        id, orderId: original.id, orderRef: ref, commercialId: user.id, commercialName: user.name,
        createdAt: new Date().toISOString(), originalUpdatedAt: original.updatedAt.toISOString(),
        originalStatus: original.status, originalDeliveryDate: original.deliveryDate.toISOString(),
        kind: "EXCHANGE", status: "PENDING", payload,
      };
      await tx.cmsContent.create({ data: { key: `order-exchange:${id}`, data: request, updatedBy: "test-exchange-fixture" } });
      await tx.chatMessage.create({ data: {
        body: `TEST — Demande d’échange ${ref}\n${payload.exchangeReason}\nÀ valider : /zangochap-manager/orders/exchanges`,
        scope: "ROLE", targetRole: "ADMIN", senderId: user.id, senderName: user.name, senderRole: "COMMERCIAL",
      } });
      const summary = { orderRef: ref, orderId: original.id, requestId: id };
      await tx.cmsContent.create({ data: { key: fixtureKey, data: summary, updatedBy: "test-exchange-fixture" } });
      return { alreadyCreated: false, ...summary };
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error("Création non confirmée : échec de connexion ou de transaction. Aucun secret affiché ; relancer la même commande est idempotent.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
