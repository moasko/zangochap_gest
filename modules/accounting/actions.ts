"use server";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";

type AccountingType = "INCOME" | "EXPENSE" | "CORRECTION";
type AccountingSource = "DELIVERY" | "CUSTOMER" | "MANUAL" | "OTHER";
type CategoryType = "INCOME" | "EXPENSE";

const db = prisma as any;
const ACCOUNTING_PATH = "/zangochap-manager/accounting";

const DEFAULT_CATEGORIES: Array<{ name: string; slug: string; type: CategoryType }> = [
  { name: "Paiement livraison", slug: "paiement-livraison", type: "INCOME" },
  { name: "Reglement client", slug: "reglement-client", type: "INCOME" },
  { name: "Avance client", slug: "avance-client", type: "INCOME" },
  { name: "Vente directe", slug: "vente-directe", type: "INCOME" },
  { name: "Autre entree", slug: "autre-entree", type: "INCOME" },
  { name: "Transport", slug: "transport", type: "EXPENSE" },
  { name: "Carburant", slug: "carburant", type: "EXPENSE" },
  { name: "Achat materiel", slug: "achat-materiel", type: "EXPENSE" },
  { name: "Salaire", slug: "salaire", type: "EXPENSE" },
  { name: "Commission livreur", slug: "commission-livreur", type: "EXPENSE" },
  { name: "Depense diverse", slug: "depense-diverse", type: "EXPENSE" },
];

function startOfLocalDay(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(value: string | Date) {
  const date = startOfLocalDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function dateInputValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function positiveAmount(value: unknown) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant doit etre superieur a 0.");
  }
  return amount;
}

async function requireAccountingUser() {
  return ensureAuth(["admin", "developer", "comptable"]);
}

async function audit(tx: any, data: {
  action: string;
  entityType: string;
  entityId?: string | null;
  sessionId?: string | null;
  operationId?: string | null;
  previousAmount?: number | null;
  newAmount?: number | null;
  reason?: string | null;
  details?: unknown;
  actor: any;
}) {
  await tx.accountingAuditLog.create({
    data: {
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId || null,
      sessionId: data.sessionId || null,
      operationId: data.operationId || null,
      previousAmount: data.previousAmount ?? null,
      newAmount: data.newAmount ?? null,
      reason: data.reason || null,
      details: data.details || undefined,
      actorId: data.actor.id,
      actorName: data.actor.name,
      actorEmail: data.actor.email,
    },
  });
}

async function ensureDefaultCategories(tx = db) {
  await Promise.all(DEFAULT_CATEGORIES.map((category) => (
    tx.accountingCategory.upsert({
      where: { slug_type: { slug: category.slug, type: category.type } },
      update: { name: category.name, isDefault: true },
      create: { ...category, isDefault: true },
    })
  )));
}

async function getDeliveryIncomeCategory(tx = db) {
  await ensureDefaultCategories(tx);
  return tx.accountingCategory.findUnique({
    where: { slug_type: { slug: "paiement-livraison", type: "INCOME" } },
  });
}

async function ensureSessionForDate(tx: any, date: string | Date, actor: any) {
  const day = startOfLocalDay(date);
  return tx.accountingSession.upsert({
    where: { date: day },
    update: {},
    create: {
      date: day,
      createdById: actor?.id,
      createdByName: actor?.name,
    },
  });
}

async function syncDeliveryOperations(session: any, actor: any) {
  // Une session cloturee est verrouillee : on ne touche plus aux ecritures.
  if (session.status === "CLOSED") return;
  const deliveryCategory = await getDeliveryIncomeCategory();
  const orders = await db.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] },
      OR: [
        { deliveryDate: { gte: session.date, lte: endOfLocalDay(session.date) } },
        { deliveryDate: null, updatedAt: { gte: session.date, lte: endOfLocalDay(session.date) } },
      ],
    },
    select: {
      id: true,
      ref: true,
      customerName: true,
      total: true,
      deliveryFee: true,
      discount: true,
      deliverymanId: true,
      deliverymanName: true,
      customerId: true,
    },
  });

  // Totaux du jour : on distingue le theorique (attendu) de l'encaisse (reel).
  // L'ecriture comptable porte l'encaisse en montant (amount) et le theorique en
  // originalAmount, ce qui permet d'afficher l'ecart sans recalcul ailleurs.
  const validOrders = orders
    .map((order: any) => ({
      ...order,
      theoreticalAmount: orderTheoreticalAmount(order),
      collectedAmount: orderCollectedAmount(order),
    }))
    .filter((order: any) => order.theoreticalAmount > 0);

  const theoreticalTotal = validOrders.reduce((sum: number, order: any) => sum + order.theoreticalAmount, 0);
  const collectedTotal = validOrders.reduce((sum: number, order: any) => sum + order.collectedAmount, 0);
  const orderCount = validOrders.length;
  const description = `${orderCount} livraison(s) du jour`;

  // Find existing grouped delivery operation for this session
  const existingGrouped = await db.accountingOperation.findFirst({
    where: { sessionId: session.id, source: "DELIVERY", deliveryOrderId: null, riderId: null },
  });

  if (orderCount === 0 && existingGrouped) {
    // Never delete accounting history automatically in production.
    return;
  }

  if (orderCount === 0) return;

  if (existingGrouped) {
    // Update existing grouped operation with latest totals
    if (existingGrouped.amount !== collectedTotal || existingGrouped.originalAmount !== theoreticalTotal) {
      const dataToUpdate: any = { originalAmount: theoreticalTotal, description };
      // If the user hasn't provided a reason (i.e. hasn't validated/edited it manually), keep amount in sync
      if (!existingGrouped.reason) {
        dataToUpdate.amount = collectedTotal;
      }
      await db.accountingOperation.update({
        where: { id: existingGrouped.id },
        data: dataToUpdate,
      });
    }
  } else {
    // Create single grouped operation
    await db.accountingOperation.create({
      data: {
        type: "INCOME",
        source: "DELIVERY",
        amount: collectedTotal,
        originalAmount: theoreticalTotal,
        description,
        sessionId: session.id,
        categoryId: deliveryCategory.id,
        deliveryOrderId: null,
        deliveryOrderRef: null,
        createdById: actor?.id,
        createdByName: actor?.name || "Synchronisation",
      },
    });
  }
}

export async function getAccountingWorkspace(date = dateInputValue()) {
  const actor = await requireAccountingUser();

  // All three operations are idempotent; no interactive transaction needed.
  await ensureDefaultCategories();
  const session = await ensureSessionForDate(db, date, actor);
  await syncDeliveryOperations(session, actor);

  const [recentSessions, openSessionsRaw, categories, operations, audits, reports, riders, customers] = await Promise.all([
    db.accountingSession.findMany({
      orderBy: { date: "desc" },
      take: 30,
      include: { operations: { select: { type: true, amount: true } } },
    }),
    // Toutes les sessions encore ouvertes (a cloturer), meme hors fenetre recente,
    // pour qu'aucune session non cloturee oubliee n'echappe au journal.
    db.accountingSession.findMany({
      where: { status: { not: "CLOSED" } },
      orderBy: { date: "desc" },
      take: 120,
      include: { operations: { select: { type: true, amount: true } } },
    }),
    db.accountingCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.accountingOperation.findMany({
      where: { sessionId: session.id },
      include: { category: true },
      orderBy: { createdAt: "desc" },
    }),
    db.accountingAuditLog.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    db.accountingReport.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    db.user.findMany({
      where: { role: "LIVREUR" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.customer.findMany({
      select: { id: true, name: true, phone: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  const totals = summarizeOperations(operations);

  // Fusionne sessions ouvertes (toutes) + sessions recentes, dedupliquees, triees
  // par date decroissante. Les ouvertes hors des 30 derniers jours restent visibles.
  const sessionsById = new Map<string, any>();
  [...openSessionsRaw, ...recentSessions].forEach((item: any) => sessionsById.set(item.id, item));
  const mergedSessions = Array.from(sessionsById.values())
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return JSON.parse(JSON.stringify({
    session,
    sessions: mergedSessions.map((item: any) => ({ ...item, summary: summarizeOperations(item.operations) })),
    openSessionsCount: openSessionsRaw.length,
    categories,
    operations,
    audits,
    reports,
    riders,
    customers,
    totals,
  }));
}

export async function getAccountingSessionIdForDate(date = dateInputValue()) {
  const actor = await requireAccountingUser();
  await ensureDefaultCategories();
  const session = await ensureSessionForDate(db, date, actor);
  await syncDeliveryOperations(session, actor);
  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${session.id}`);
  return session.id;
}

function summarizeOperations(operations: Array<{ type: AccountingType; amount: number }>) {
  const totalIncome = operations
    .filter((operation) => operation.type === "INCOME" || (operation.type === "CORRECTION" && operation.amount > 0))
    .reduce((sum, operation) => sum + Math.abs(Number(operation.amount || 0)), 0);
  const totalExpense = operations
    .filter((operation) => operation.type === "EXPENSE" || (operation.type === "CORRECTION" && operation.amount < 0))
    .reduce((sum, operation) => sum + Math.abs(Number(operation.amount || 0)), 0);
  return {
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    count: operations.length,
  };
}

// Valeur theorique attendue d'une commande (total + frais - remise), avant prise
// en compte de ce qui a reellement ete encaisse par le livreur.
function orderTheoreticalAmount(order: any) {
  return Math.max(0, Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0));
}

// Montant reellement encaisse : amountReceived s'il est renseigne, sinon la valeur
// theorique. C'est la SEULE base utilisee pour le solde de caisse, partout (journal,
// detail session, reglement livreur) afin d'eviter les ecarts entre modules.
function orderCollectedAmount(order: any) {
  return Math.max(0, Number(order.amountReceived ?? orderTheoreticalAmount(order)));
}

async function getSessionRiderSummaries(session: any) {
  const orders = await db.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] },
      OR: [
        { deliveryDate: { gte: session.date, lte: endOfLocalDay(session.date) } },
        { deliveryDate: null, updatedAt: { gte: session.date, lte: endOfLocalDay(session.date) } },
      ],
    },
    select: {
      id: true,
      ref: true,
      customerName: true,
      total: true,
      deliveryFee: true,
      discount: true,
      amountReceived: true,
      status: true,
      deliverymanId: true,
      deliverymanName: true,
      deliveryDate: true,
      updatedAt: true,
    },
    orderBy: [{ deliverymanName: "asc" }, { deliveryDate: "asc" }],
  });

  const groups = new Map<string, any>();
  orders.forEach((order: any) => {
    const riderId = order.deliverymanId || "UNASSIGNED";
    const riderName = order.deliverymanName || "Livreur non renseigne";
    const theoreticalAmount = orderTheoreticalAmount(order);
    const collectedAmount = orderCollectedAmount(order);
    const group = groups.get(riderId) || {
      riderId,
      riderName,
      ordersCount: 0,
      expectedAmount: 0,   // theorique attendu (total + frais - remise)
      collectedAmount: 0,  // reellement encaisse (amountReceived)
      orders: [],
    };
    group.ordersCount += 1;
    group.expectedAmount += theoreticalAmount;
    group.collectedAmount += collectedAmount;
    group.orders.push({ ...order, expectedAmount: theoreticalAmount, collectedAmount });
    groups.set(riderId, group);
  });

  return Array.from(groups.values()).sort((a: any, b: any) => a.riderName.localeCompare(b.riderName));
}

export async function getAccountingSessionDetail(sessionId: string) {
  const actor = await requireAccountingUser();
  await ensureDefaultCategories();

  const session = await db.accountingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session comptable introuvable.");

  const [categories, operations, audits, riderSummaries, sessions] = await Promise.all([
    db.accountingCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.accountingOperation.findMany({
      where: { sessionId },
      include: { category: true },
      orderBy: [{ source: "asc" }, { createdAt: "desc" }],
    }),
    db.accountingAuditLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    getSessionRiderSummaries(session),
    db.accountingSession.findMany({
      orderBy: { date: "desc" },
      take: 30,
      include: { operations: { select: { type: true, amount: true } } },
    }),
  ]);

  const operationByRider = new Map<string, any>(
    operations
      .filter((operation: any) => operation.source === "DELIVERY" && operation.riderId)
      .map((operation: any) => [operation.riderId, operation]),
  );

  const riders = riderSummaries.map((summary: any) => {
    const operation = operationByRider.get(summary.riderId) || null;
    const validatedAmount = Number(operation?.amount || 0);
    const expectedAmount = Number(summary.expectedAmount || 0);
    const collectedAmount = Number(summary.collectedAmount || 0);
    return {
      ...summary,
      operation,
      validatedAmount,
      isValidated: Boolean(operation),
      // Ecart de collecte : ce que le livreur a encaisse vs le theorique attendu.
      collectionVariance: collectedAmount - expectedAmount,
      // Ecart de validation : montant valide en caisse vs encaisse declare.
      variance: validatedAmount - collectedAmount,
    };
  });
  const totals = summarizeOperations(operations);

  return JSON.parse(JSON.stringify({
    actor: { id: actor.id, name: actor.name, role: actor.role },
    session,
    sessions: sessions.map((item: any) => ({ ...item, summary: summarizeOperations(item.operations) })),
    categories,
    operations,
    audits,
    riders,
    totals,
  }));
}

export async function validateRiderAccountingEntry(data: {
  sessionId: string;
  riderId: string;
  riderName: string;
  amount: number;
  reason?: string;
}) {
  const actor = await requireAccountingUser();
  const amount = positiveAmount(data.amount);
  const riderId = data.riderId || "UNASSIGNED";
  const riderName = data.riderName?.trim() || "Livreur non renseigne";
  const reason = data.reason?.trim() || "Validation entree livreur";

  await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: data.sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour valider une entree livreur.");
    const category = await getDeliveryIncomeCategory(tx);
    if (!category) throw new Error("Categorie livraison introuvable.");
    const riderSummaries = await getSessionRiderSummaries(session);
    const riderSummary = riderSummaries.find((item: any) => item.riderId === riderId);
    if (!riderSummary) throw new Error("Aucune livraison trouvee pour ce livreur sur cette session.");

    const previous = await tx.accountingOperation.findFirst({
      where: {
        sessionId: data.sessionId,
        source: "DELIVERY",
        riderId,
        deliveryOrderId: null,
      },
    });

    const legacyGlobal = await tx.accountingOperation.findFirst({
      where: {
        sessionId: data.sessionId,
        source: "DELIVERY",
        riderId: null,
        deliveryOrderId: null,
        amount: { gt: 0 },
      },
    });

    if (legacyGlobal) {
      const updatedLegacy = await tx.accountingOperation.update({
        where: { id: legacyGlobal.id },
        data: {
          amount: 0,
          reason: "Remplacee par validation detaillee des entrees livreurs",
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });
      await audit(tx, {
        action: "LEGACY_DELIVERY_ENTRY_NEUTRALIZED",
        entityType: "AccountingOperation",
        entityId: updatedLegacy.id,
        sessionId: data.sessionId,
        operationId: updatedLegacy.id,
        previousAmount: legacyGlobal.amount,
        newAmount: 0,
        reason: "Remplacee par validation detaillee des entrees livreurs",
        actor,
        details: { previousDescription: legacyGlobal.description },
      });
    }

    const payload = {
      sessionId: data.sessionId,
      categoryId: category.id,
      type: "INCOME" as AccountingType,
      source: "DELIVERY" as AccountingSource,
      amount,
      originalAmount: riderSummary.expectedAmount,
      description: `Entree livreur - ${riderName} (${riderSummary.ordersCount} livraison(s))`,
      riderId,
      riderName,
      reason,
      updatedById: actor.id,
      updatedByName: actor.name,
    };

    const operation = previous
      ? await tx.accountingOperation.update({ where: { id: previous.id }, data: payload })
      : await tx.accountingOperation.create({
        data: {
          ...payload,
          createdById: actor.id,
          createdByName: actor.name,
        },
      });

    await audit(tx, {
      action: previous ? "RIDER_ENTRY_VALIDATED_UPDATED" : "RIDER_ENTRY_VALIDATED",
      entityType: "AccountingOperation",
      entityId: operation.id,
      sessionId: data.sessionId,
      operationId: operation.id,
      previousAmount: previous?.amount ?? null,
      newAmount: amount,
      reason,
      actor,
      details: {
        riderId,
        riderName,
        expectedAmount: riderSummary.expectedAmount,
        ordersCount: riderSummary.ordersCount,
      },
    });
  });

  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${data.sessionId}`);
  return { success: true };
}

export async function closeAccountingSession(sessionId: string, reason?: string) {
  const actor = await requireAccountingUser();
  await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Cette session est deja cloturee.");
    await tx.accountingSession.update({ where: { id: sessionId }, data: { status: "CLOSED" } });
    await audit(tx, {
      action: "SESSION_CLOSED",
      entityType: "AccountingSession",
      entityId: sessionId,
      sessionId,
      reason: reason?.trim() || "Cloture de la session comptable",
      actor,
    });
  });
  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${sessionId}`);
  return { success: true };
}

export async function reopenAccountingSession(sessionId: string, reason: string) {
  // La reouverture est sensible (deverrouille des ecritures validees) : admin/dev only.
  const actor = await ensureAuth(["admin", "developer"]);
  const note = reason?.trim();
  if (!note) throw new Error("Un motif est obligatoire pour reouvrir une session.");
  await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status !== "CLOSED") throw new Error("Cette session n'est pas cloturee.");
    await tx.accountingSession.update({ where: { id: sessionId }, data: { status: "OPEN" } });
    await audit(tx, {
      action: "SESSION_REOPENED",
      entityType: "AccountingSession",
      entityId: sessionId,
      sessionId,
      reason: note,
      actor,
    });
  });
  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${sessionId}`);
  return { success: true };
}

export async function createAccountingCategory(data: { name: string; type: CategoryType }) {
  const actor = await requireAccountingUser();
  const name = data.name.trim();
  if (name.length < 2) throw new Error("Nom de categorie trop court.");
  const type = data.type === "EXPENSE" ? "EXPENSE" : "INCOME";
  const slug = slugify(name);
  if (!slug) throw new Error("Nom de categorie invalide.");

  const category = await db.$transaction(async (tx: any) => {
    const created = await tx.accountingCategory.create({
      data: {
        name,
        slug,
        type,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    await audit(tx, {
      action: "CATEGORY_CREATED",
      entityType: "AccountingCategory",
      entityId: created.id,
      actor,
      details: { name, type },
    });
    return created;
  });

  revalidatePath(ACCOUNTING_PATH);
  return { success: true, category };
}

export async function updateAccountingCategory(id: string, data: { name: string }) {
  const actor = await requireAccountingUser();
  const name = data.name.trim();
  if (name.length < 2) throw new Error("Nom de categorie trop court.");

  await db.$transaction(async (tx: any) => {
    const previous = await tx.accountingCategory.findUnique({ where: { id } });
    if (!previous) throw new Error("Categorie introuvable.");
    const updated = await tx.accountingCategory.update({
      where: { id },
      data: { name, slug: slugify(name) },
    });
    await audit(tx, {
      action: "CATEGORY_UPDATED",
      entityType: "AccountingCategory",
      entityId: id,
      actor,
      details: { before: previous.name, after: updated.name },
    });
  });

  revalidatePath(ACCOUNTING_PATH);
  return { success: true };
}

export async function deleteAccountingCategory(id: string) {
  const actor = await requireAccountingUser();

  await db.$transaction(async (tx: any) => {
    const category = await tx.accountingCategory.findUnique({
      where: { id },
      include: { _count: { select: { operations: true } } },
    });
    if (!category) throw new Error("Categorie introuvable.");
    if (category.isDefault) throw new Error("Une categorie par defaut ne peut pas etre supprimee.");
    if (category._count.operations > 0) throw new Error("Categorie deja utilisee: suppression impossible.");

    await tx.accountingCategory.delete({ where: { id } });
    await audit(tx, {
      action: "CATEGORY_DELETED",
      entityType: "AccountingCategory",
      entityId: id,
      actor,
      details: { name: category.name, type: category.type },
    });
  });

  revalidatePath(ACCOUNTING_PATH);
  return { success: true };
}

export async function createAccountingOperation(data: {
  sessionId: string;
  categoryId: string;
  type: AccountingType;
  source?: AccountingSource;
  amount: number;
  description?: string;
  proofUrl?: string;
}) {
  const actor = await requireAccountingUser();
  const amount = positiveAmount(data.amount);
  const type: AccountingType = data.type === "EXPENSE" ? "EXPENSE" : data.type === "CORRECTION" ? "CORRECTION" : "INCOME";

  const operation = await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: data.sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour ajouter une ecriture.");
    const category = await tx.accountingCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new Error("Categorie introuvable.");
    if (type !== "CORRECTION" && category.type !== type) {
      throw new Error("La categorie ne correspond pas au type d'operation.");
    }

    const created = await tx.accountingOperation.create({
      data: {
        sessionId: data.sessionId,
        categoryId: data.categoryId,
        type,
        source: data.source || "MANUAL",
        amount,
        description: data.description?.trim() || null,
        proofUrl: data.proofUrl?.trim() || null,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    await audit(tx, {
      action: "OPERATION_CREATED",
      entityType: "AccountingOperation",
      entityId: created.id,
      sessionId: data.sessionId,
      operationId: created.id,
      newAmount: amount,
      actor,
      details: { type, source: data.source || "MANUAL" },
    });
    return created;
  });

  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${data.sessionId}`);
  return { success: true, operation };
}

export async function updateAccountingOperation(id: string, data: {
  amount: number;
  categoryId?: string;
  description?: string;
  proofUrl?: string;
  reason?: string;
}) {
  const actor = await requireAccountingUser();
  const amount = positiveAmount(data.amount);
  const reason = data.reason?.trim() || "Regularisation comptable";

  const sessionId = await db.$transaction(async (tx: any) => {
    const previous = await tx.accountingOperation.findUnique({ where: { id } });
    if (!previous) throw new Error("Operation introuvable.");
    const session = await tx.accountingSession.findUnique({ where: { id: previous.sessionId } });
    if (session?.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour regulariser cette ecriture.");

    const updated = await tx.accountingOperation.update({
      where: { id },
      data: {
        amount,
        categoryId: data.categoryId || previous.categoryId,
        description: data.description?.trim() ?? previous.description,
        proofUrl: data.proofUrl?.trim() ?? previous.proofUrl,
        reason,
        updatedById: actor.id,
        updatedByName: actor.name,
      },
    });

    await audit(tx, {
      action: "OPERATION_UPDATED",
      entityType: "AccountingOperation",
      entityId: id,
      sessionId: previous.sessionId,
      operationId: id,
      previousAmount: previous.amount,
      newAmount: updated.amount,
      reason,
      actor,
      details: { source: previous.source, deliveryOrderRef: previous.deliveryOrderRef },
    });
    return previous.sessionId;
  });

  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${sessionId}`);
  return { success: true };
}

export async function deleteAccountingOperation(id: string, reason?: string) {
  const actor = await requireAccountingUser();

  await db.$transaction(async (tx: any) => {
    const operation = await tx.accountingOperation.findUnique({ where: { id } });
    if (!operation) throw new Error("Operation introuvable.");
    const session = await tx.accountingSession.findUnique({ where: { id: operation.sessionId } });
    if (session?.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour supprimer cette ecriture.");
    if (operation.source === "DELIVERY") {
      throw new Error("Une entree de livraison doit etre regularisee plutot que supprimee.");
    }

    await tx.accountingOperation.delete({ where: { id } });
    await audit(tx, {
      action: "OPERATION_DELETED",
      entityType: "AccountingOperation",
      entityId: id,
      sessionId: operation.sessionId,
      previousAmount: operation.amount,
      reason: reason?.trim() || "Suppression comptable",
      actor,
      details: { type: operation.type, source: operation.source },
    });
  });

  revalidatePath(ACCOUNTING_PATH);
  return { success: true };
}

export async function createAccountingReport(data: {
  name: string;
  dateFrom: string;
  dateTo: string;
  categoryIds?: string[];
  riderIds?: string[];
  customerIds?: string[];
  sessionIds?: string[];
  operationTypes?: AccountingType[];
  description?: string;
}) {
  const actor = await requireAccountingUser();
  const name = data.name.trim();
  if (name.length < 2) throw new Error("Nom du bilan requis.");
  const dateFrom = startOfLocalDay(data.dateFrom);
  const dateTo = endOfLocalDay(data.dateTo);
  if (dateFrom > dateTo) throw new Error("La date de debut doit preceder la date de fin.");
  const operationTypes = data.operationTypes?.length ? data.operationTypes : ["INCOME", "EXPENSE", "CORRECTION"];

  const categoryIds = Array.from(new Set(data.categoryIds || []));
  const riderIds = Array.from(new Set(data.riderIds || []));
  const sessionIds = Array.from(new Set(data.sessionIds || []));

  // On filtre par la DATE DE SESSION (jour comptable) et non par createdAt : une
  // ecriture de livraison est creee lors de la synchro (visite de la page), pas le
  // jour de la livraison. Filtrer sur la session aligne le bilan sur le jour reel.
  const where: any = {
    session: { is: { date: { gte: dateFrom, lte: dateTo } } },
    type: { in: operationTypes },
  };
  if (categoryIds.length) where.categoryId = { in: categoryIds };
  if (riderIds.length) where.riderId = { in: riderIds };
  if (data.customerIds?.length) where.customerId = { in: Array.from(new Set(data.customerIds)) };
  if (sessionIds.length) where.sessionId = { in: sessionIds };

  const operations = await db.accountingOperation.findMany({ where, select: { type: true, amount: true, sessionId: true } });
  const totals = summarizeOperations(operations);
  const reportSessionIds = Array.from(new Set(operations.map((operation: any) => operation.sessionId)));

  const report = await db.accountingReport.create({
    data: {
      name,
      description: data.description?.trim() || null,
      dateFrom,
      dateTo,
      operationTypes,
      filters: {
        categoryIds,
        riderIds,
        customerIds: data.customerIds || [],
        sessionIds,
      },
      totalIncome: totals.totalIncome,
      totalExpense: totals.totalExpense,
      balance: totals.balance,
      operationsCount: operations.length,
      createdById: actor.id,
      createdByName: actor.name,
      categories: categoryIds.length ? { connect: categoryIds.map((id) => ({ id })) } : undefined,
      sessions: reportSessionIds.length ? { connect: reportSessionIds.map((id) => ({ id })) } : undefined,
    },
  });

  await db.accountingAuditLog.create({
    data: {
      action: "REPORT_CREATED",
      entityType: "AccountingReport",
      entityId: report.id,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      details: { name, totals },
    },
  });

  revalidatePath(ACCOUNTING_PATH);
  return { success: true, report };
}
