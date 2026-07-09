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

// Le dimanche est chome : aucune session comptable ne doit etre generee
// automatiquement ce jour-la. Une demande automatique tombant un dimanche est
// rabattue sur le samedi (dernier jour ouvre) pour ne pas creer de session vide.
function toWorkingDay(value: string | Date) {
  const day = startOfLocalDay(value);
  if (day.getDay() === 0) day.setDate(day.getDate() - 1);
  return day;
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

// Une validation livreur peut etre a 0 (livreur sans encaisse : commandes impayees)
// pour pouvoir marquer son controle comme fait.
function nonNegativeAmount(value: unknown) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Le montant ne peut pas etre negatif.");
  }
  return amount;
}

// Une CORRECTION peut diminuer la caisse : on accepte un montant negatif (mais jamais nul).
// Les entrees/sorties restent strictement positives via positiveAmount.
function signedAmount(value: unknown) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Le montant ne peut pas etre nul.");
  }
  return amount;
}

function amountForType(type: AccountingType, value: unknown) {
  return type === "CORRECTION" ? signedAmount(value) : positiveAmount(value);
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
  // Sessions automatiques : jamais le dimanche (rabattu sur le samedi).
  const day = toWorkingDay(date);
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

// Recalcule l'ecriture de livraison "groupee" (riderId null) pour qu'elle ne porte
// QUE les livreurs pas encore valides individuellement. Ainsi le journal reflete
// toujours : entrees validees (par livreur) + encaisse restant a valider (groupee),
// sans jamais sous-compter la recette du jour pendant la validation. Accepte db ou tx.
async function recomputeGroupedDelivery(client: any, session: any, category: any) {
  const riderSummaries = await getSessionRiderSummaries(session);

  const validatedOps = await client.accountingOperation.findMany({
    where: { sessionId: session.id, source: "DELIVERY", deliveryOrderId: null, riderId: { not: null } },
    select: { riderId: true },
  });
  const validated = new Set<string>(validatedOps.map((op: any) => op.riderId));

  const pending = riderSummaries.filter((rider: any) => !validated.has(rider.riderId));
  const collectedTotal = pending.reduce((sum: number, rider: any) => sum + Number(rider.collectedAmount || 0), 0);
  const theoreticalTotal = pending.reduce((sum: number, rider: any) => sum + Number(rider.expectedAmount || 0), 0);
  const orderCount = pending.reduce((sum: number, rider: any) => sum + Number(rider.ordersCount || 0), 0);
  const description = orderCount > 0
    ? `${orderCount} livraison(s) a valider`
    : "Toutes les entrees livreurs sont validees";

  const existing = await client.accountingOperation.findFirst({
    where: { sessionId: session.id, source: "DELIVERY", deliveryOrderId: null, riderId: null },
  });

  if (!existing) {
    if (orderCount === 0) return;
    await client.accountingOperation.create({
      data: {
        type: "INCOME",
        source: "DELIVERY",
        amount: collectedTotal,
        originalAmount: theoreticalTotal,
        description,
        sessionId: session.id,
        categoryId: category.id,
        deliveryOrderId: null,
        deliveryOrderRef: null,
        riderId: null,
        createdByName: "Synchronisation",
      },
    });
    return;
  }

  if (existing.amount !== collectedTotal || existing.originalAmount !== theoreticalTotal || existing.description !== description) {
    await client.accountingOperation.update({
      where: { id: existing.id },
      data: { amount: collectedTotal, originalAmount: theoreticalTotal, description },
    });
  }
}

async function syncDeliveryOperations(session: any) {
  // Une session cloturee est verrouillee : on ne touche plus aux ecritures.
  if (session.status === "CLOSED") return;
  const deliveryCategory = await getDeliveryIncomeCategory();
  await recomputeGroupedDelivery(db, session, deliveryCategory);
}

export async function getAccountingWorkspace(date = dateInputValue()) {
  const actor = await requireAccountingUser();

  // All three operations are idempotent; no interactive transaction needed.
  await ensureDefaultCategories();
  const session = await ensureSessionForDate(db, date, actor);
  await syncDeliveryOperations(session);

  const [recentSessions, openSessionsRaw, categories, operations, audits, reports, riders, customers] = await Promise.all([
    db.accountingSession.findMany({
      orderBy: { date: "desc" },
      take: 30,
      include: { operations: { select: { type: true, amount: true, source: true, riderId: true } } },
    }),
    // Toutes les sessions encore ouvertes (a cloturer), meme hors fenetre recente,
    // pour qu'aucune session non cloturee oubliee n'echappe au journal.
    db.accountingSession.findMany({
      where: { status: { not: "CLOSED" } },
      orderBy: { date: "desc" },
      take: 120,
      include: { operations: { select: { type: true, amount: true, source: true, riderId: true } } },
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
    sessions: mergedSessions.map((item: any) => ({
      ...item,
      summary: summarizeOperations(item.operations),
      // Une ecriture de livraison groupee (riderId null) avec un montant > 0 signifie
      // qu'il reste des livreurs a valider sur cette session.
      pendingDelivery: item.operations.some((op: any) => op.source === "DELIVERY" && !op.riderId && Number(op.amount) > 0),
    })),
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
  await syncDeliveryOperations(session);
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
  // Rattachement d'une commande a un jour comptable, par ordre de fiabilite :
  // deliveryDate, sinon lastDeliveryAttemptAt (pose a la cloture de livraison,
  // stable), sinon updatedAt (legacy uniquement). updatedAt en premier recours
  // faisait MIGRER une commande deja validee vers la session du jour d'une
  // simple modification => risque de double comptage.
  const orders = await db.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] },
      OR: [
        { deliveryDate: { gte: session.date, lte: endOfLocalDay(session.date) } },
        { deliveryDate: null, lastDeliveryAttemptAt: { gte: session.date, lte: endOfLocalDay(session.date) } },
        { deliveryDate: null, lastDeliveryAttemptAt: null, updatedAt: { gte: session.date, lte: endOfLocalDay(session.date) } },
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
  const amount = nonNegativeAmount(data.amount);
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

    // Ce livreur est desormais valide : on retire son encaisse de l'ecriture groupee
    // (qui ne porte plus que les livreurs restant a valider).
    await recomputeGroupedDelivery(tx, session, category);
  });

  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${data.sessionId}`);
  return { success: true };
}

// Annule la validation d'un livreur : supprime son ecriture individuelle et
// reintegre son encaisse dans l'ecriture groupee (le livreur repasse "a valider").
// Motif obligatoire : c'est la seule voie de suppression d'une ecriture DELIVERY.
export async function cancelRiderValidation(data: {
  sessionId: string;
  riderId: string;
  reason: string;
}) {
  const actor = await requireAccountingUser();
  const reason = data.reason?.trim();
  if (!reason) throw new Error("Un motif est obligatoire pour annuler une validation livreur.");

  await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: data.sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour annuler une validation.");
    const category = await getDeliveryIncomeCategory(tx);
    if (!category) throw new Error("Categorie livraison introuvable.");

    const operation = await tx.accountingOperation.findFirst({
      where: { sessionId: data.sessionId, source: "DELIVERY", riderId: data.riderId, deliveryOrderId: null },
    });
    if (!operation) throw new Error("Aucune validation trouvee pour ce livreur sur cette session.");

    await tx.accountingOperation.delete({ where: { id: operation.id } });
    // Pas d'operationId dans l'audit : l'ecriture vient d'etre supprimee.
    await audit(tx, {
      action: "RIDER_ENTRY_CANCELLED",
      entityType: "AccountingOperation",
      entityId: operation.id,
      sessionId: data.sessionId,
      previousAmount: operation.amount,
      reason,
      actor,
      details: { riderId: data.riderId, riderName: operation.riderName },
    });

    await recomputeGroupedDelivery(tx, session, category);
  });

  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${data.sessionId}`);
  return { success: true };
}

// Valide en une fois tous les livreurs PAS ENCORE valides, a leur montant encaisse
// reel. Ne touche pas aux livreurs deja valides/ajustes manuellement.
export async function validateAllRiders(sessionId: string) {
  const actor = await requireAccountingUser();
  let count = 0;
  await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour valider les entrees.");
    const category = await getDeliveryIncomeCategory(tx);
    if (!category) throw new Error("Categorie livraison introuvable.");

    const riderSummaries = await getSessionRiderSummaries(session);
    for (const summary of riderSummaries) {
      const collected = Math.round(Number(summary.collectedAmount || 0));
      if (collected <= 0) continue;

      const existing = await tx.accountingOperation.findFirst({
        where: { sessionId, source: "DELIVERY", riderId: summary.riderId, deliveryOrderId: null },
      });
      if (existing) continue; // ne pas ecraser une validation/ajustement existant

      const operation = await tx.accountingOperation.create({
        data: {
          sessionId,
          categoryId: category.id,
          type: "INCOME" as AccountingType,
          source: "DELIVERY" as AccountingSource,
          amount: collected,
          originalAmount: summary.expectedAmount,
          description: `Entree livreur - ${summary.riderName} (${summary.ordersCount} livraison(s))`,
          riderId: summary.riderId,
          riderName: summary.riderName,
          reason: "Validation groupee (encaisse)",
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
      await audit(tx, {
        action: "RIDER_ENTRY_VALIDATED",
        entityType: "AccountingOperation",
        entityId: operation.id,
        sessionId,
        operationId: operation.id,
        newAmount: collected,
        reason: "Validation groupee",
        actor,
        details: { riderId: summary.riderId, riderName: summary.riderName, ordersCount: summary.ordersCount, bulk: true },
      });
      count += 1;
    }

    await recomputeGroupedDelivery(tx, session, category);
  });

  revalidatePath(ACCOUNTING_PATH);
  revalidatePath(`${ACCOUNTING_PATH}/sessions/${sessionId}`);
  return { success: true, count };
}

export async function closeAccountingSession(
  sessionId: string,
  options?: { processedAt?: string; reason?: string },
) {
  const actor = await requireAccountingUser();
  // Date de traitement obligatoire et saisie manuellement : le jour ou la caisse a
  // ete reellement traitee/rapprochee avant verrouillage.
  const rawProcessedAt = options?.processedAt?.trim();
  if (!rawProcessedAt) {
    throw new Error("La date de traitement est obligatoire pour cloturer la session.");
  }
  const processedAt = startOfLocalDay(rawProcessedAt);
  if (Number.isNaN(processedAt.getTime())) {
    throw new Error("Date de traitement invalide.");
  }
  const reason = options?.reason;
  await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Cette session est deja cloturee.");
    await tx.accountingSession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", processedAt, processedByName: actor.name },
    });
    await audit(tx, {
      action: "SESSION_CLOSED",
      entityType: "AccountingSession",
      entityId: sessionId,
      sessionId,
      reason: reason?.trim() || "Cloture de la session comptable",
      actor,
      details: { processedAt: dateInputValue(processedAt) },
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
  customerId?: string;
  reason?: string;
}) {
  const actor = await requireAccountingUser();
  const type: AccountingType = data.type === "EXPENSE" ? "EXPENSE" : data.type === "CORRECTION" ? "CORRECTION" : "INCOME";
  const amount = amountForType(type, data.amount);
  const reason = data.reason?.trim() || null;

  const operation = await db.$transaction(async (tx: any) => {
    const session = await tx.accountingSession.findUnique({ where: { id: data.sessionId } });
    if (!session) throw new Error("Session comptable introuvable.");
    if (session.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour ajouter une ecriture.");
    const category = await tx.accountingCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new Error("Categorie introuvable.");
    if (type !== "CORRECTION" && category.type !== type) {
      throw new Error("La categorie ne correspond pas au type d'operation.");
    }

    // Une operation qui DIMINUE la caisse (sortie ou correction negative) et rend
    // le solde de la session negatif est autorisee, mais EXIGE un motif.
    const signedValue = type === "EXPENSE" ? -amount : amount;
    if (signedValue < 0) {
      const existing = await tx.accountingOperation.findMany({
        where: { sessionId: data.sessionId },
        select: { type: true, amount: true },
      });
      const projectedBalance = summarizeOperations(existing).balance + signedValue;
      if (projectedBalance < 0 && !reason) {
        throw new Error("Cette operation rend le solde de caisse negatif : un motif est obligatoire.");
      }
    }

    // Rattachement client optionnel : on resout le nom et on bascule la source sur
    // CUSTOMER pour que les bilans/filtres par client soient exploitables.
    let customerId: string | null = null;
    let clientName: string | null = null;
    if (data.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: data.customerId }, select: { id: true, name: true } });
      if (!customer) throw new Error("Client introuvable.");
      customerId = customer.id;
      clientName = customer.name;
    }
    const source: AccountingSource = customerId ? "CUSTOMER" : (data.source || "MANUAL");

    const created = await tx.accountingOperation.create({
      data: {
        sessionId: data.sessionId,
        categoryId: data.categoryId,
        type,
        source,
        amount,
        description: data.description?.trim() || null,
        proofUrl: data.proofUrl?.trim() || null,
        reason,
        customerId,
        clientName,
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
      reason,
      actor,
      details: { type, source },
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
  const reason = data.reason?.trim() || "Regularisation comptable";

  const sessionId = await db.$transaction(async (tx: any) => {
    const previous = await tx.accountingOperation.findUnique({ where: { id } });
    if (!previous) throw new Error("Operation introuvable.");
    const session = await tx.accountingSession.findUnique({ where: { id: previous.sessionId } });
    if (session?.status === "CLOSED") throw new Error("Session cloturee : reouvrez-la pour regulariser cette ecriture.");
    const amount = amountForType(previous.type, data.amount);

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
  source?: string;
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
  const customerIds = Array.from(new Set(data.customerIds || []));
  if (categoryIds.length) where.categoryId = { in: categoryIds };
  if (riderIds.length) where.riderId = { in: riderIds };
  if (customerIds.length) where.customerId = { in: customerIds };
  if (sessionIds.length) where.sessionId = { in: sessionIds };
  if (data.source && data.source !== "ALL") where.source = data.source;

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
        customerIds,
        sessionIds,
        source: data.source && data.source !== "ALL" ? data.source : null,
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

// Bilan sur une periode : totaux, repartition par categorie et par jour, plus la
// liste des ecritures. Filtre toujours par DATE DE SESSION (jour comptable reel).
export async function getAccountingBilan(filters: {
  dateFrom: string;
  dateTo: string;
  scope?: "BOTH" | "INCOME" | "EXPENSE";
  categoryIds?: string[];
  riderIds?: string[];
  customerIds?: string[];
  source?: string;
}) {
  await requireAccountingUser();
  const dateFrom = startOfLocalDay(filters.dateFrom);
  const dateTo = endOfLocalDay(filters.dateTo);
  if (dateFrom > dateTo) throw new Error("La date de debut doit preceder la date de fin.");

  const operationTypes = filters.scope === "INCOME"
    ? ["INCOME"]
    : filters.scope === "EXPENSE"
      ? ["EXPENSE"]
      : ["INCOME", "EXPENSE", "CORRECTION"];

  const categoryIds = Array.from(new Set(filters.categoryIds || []));
  const riderIds = Array.from(new Set(filters.riderIds || []));
  const customerIds = Array.from(new Set(filters.customerIds || []));

  // Filtres communs SANS le type : le type est reparti en "cote credit/debit"
  // ci-dessous pour pouvoir agreger en SQL (une CORRECTION change de cote selon
  // son signe).
  const baseWhere: any = {
    session: { is: { date: { gte: dateFrom, lte: dateTo } } },
  };
  if (categoryIds.length) baseWhere.categoryId = { in: categoryIds };
  if (riderIds.length) baseWhere.riderId = { in: riderIds };
  if (customerIds.length) baseWhere.customerId = { in: customerIds };
  if (filters.source && filters.source !== "ALL") baseWhere.source = filters.source;

  const where = { ...baseWhere, type: { in: operationTypes } };

  const incomeClauses: any[] = [];
  if (operationTypes.includes("INCOME")) incomeClauses.push({ type: "INCOME" });
  if (operationTypes.includes("CORRECTION")) incomeClauses.push({ type: "CORRECTION", amount: { gt: 0 } });
  const expenseClauses: any[] = [];
  if (operationTypes.includes("EXPENSE")) expenseClauses.push({ type: "EXPENSE" });
  if (operationTypes.includes("CORRECTION")) expenseClauses.push({ type: "CORRECTION", amount: { lt: 0 } });

  // Agregats SQL : les totaux/repartitions couvrent TOUTES les ecritures de la
  // periode (l'ancien findMany plafonne a 2000 lignes faussait les totaux).
  const groupSide = (clauses: any[], by: "categoryId" | "sessionId") => (clauses.length
    ? db.accountingOperation.groupBy({
      by: [by],
      where: { ...baseWhere, OR: clauses },
      _sum: { amount: true },
      _count: { _all: true },
    })
    : Promise.resolve([]));

  const [incomeByCategory, expenseByCategory, incomeBySession, expenseBySession, operationsCount, rowOperations, categories, riders, customers] = await Promise.all([
    groupSide(incomeClauses, "categoryId"),
    groupSide(expenseClauses, "categoryId"),
    groupSide(incomeClauses, "sessionId"),
    groupSide(expenseClauses, "sessionId"),
    db.accountingOperation.count({ where }),
    db.accountingOperation.findMany({
      where,
      include: { category: true, session: { select: { date: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.accountingCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.user.findMany({ where: { role: "LIVREUR" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ]);

  const sumAbs = (groups: any[]) => groups.reduce((sum: number, group: any) => sum + Math.abs(Number(group._sum?.amount || 0)), 0);
  const totalIncome = sumAbs(incomeByCategory);
  const totalExpense = sumAbs(expenseByCategory);
  const totals = {
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    count: operationsCount,
  };

  const categoryById = new Map<string, any>(categories.map((category: any) => [category.id, category]));
  const categoryMap = new Map<string, any>();
  const foldCategory = (groups: any[], side: "income" | "expense") => {
    for (const group of groups) {
      const key = group.categoryId || "none";
      const known = categoryById.get(group.categoryId);
      const entry = categoryMap.get(key) || {
        categoryId: key,
        name: known?.name || "Sans categorie",
        type: known?.type || (side === "expense" ? "EXPENSE" : "INCOME"),
        income: 0,
        expense: 0,
        count: 0,
      };
      entry[side] += Math.abs(Number(group._sum?.amount || 0));
      entry.count += Number(group._count?._all || 0);
      categoryMap.set(key, entry);
    }
  };
  foldCategory(incomeByCategory, "income");
  foldCategory(expenseByCategory, "expense");
  const byCategory = Array.from(categoryMap.values())
    .sort((a: any, b: any) => (b.income + b.expense) - (a.income + a.expense));

  // Jour comptable en date LOCALE (dateInputValue) : toISOString (UTC) decalait
  // chaque journee d'un jour des que le serveur n'etait pas en UTC.
  const sessionIds = Array.from(new Set([...incomeBySession, ...expenseBySession].map((group: any) => group.sessionId)));
  const sessionDates = sessionIds.length
    ? await db.accountingSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, date: true } })
    : [];
  const dayBySession = new Map<string, string>(sessionDates.map((item: any) => [item.id, dateInputValue(new Date(item.date))]));
  const dayMap = new Map<string, any>();
  const foldDay = (groups: any[], side: "income" | "expense") => {
    for (const group of groups) {
      const dayKey = dayBySession.get(group.sessionId);
      if (!dayKey) continue;
      const entry = dayMap.get(dayKey) || { date: dayKey, income: 0, expense: 0, count: 0 };
      entry[side] += Math.abs(Number(group._sum?.amount || 0));
      entry.count += Number(group._count?._all || 0);
      dayMap.set(dayKey, entry);
    }
  };
  foldDay(incomeBySession, "income");
  foldDay(expenseBySession, "expense");
  const byDay = Array.from(dayMap.values())
    .sort((a: any, b: any) => a.date.localeCompare(b.date));

  const rows = rowOperations.map((op: any) => ({
    id: op.id,
    date: op.session.date,
    type: op.type,
    source: op.source,
    amount: op.amount,
    description: op.description,
    categoryName: op.category?.name || null,
    riderName: op.riderName || null,
    clientName: op.clientName || null,
  }));

  return JSON.parse(JSON.stringify({
    range: { from: dateInputValue(dateFrom), to: dateInputValue(dateTo) },
    scope: filters.scope || "BOTH",
    totals,
    byCategory,
    byDay,
    operations: rows,
    operationsCount,
    categories,
    riders,
    customers,
  }));
}

// Re-execute la requete d'un bilan enregistre pour exporter ses ecritures detaillees
// (l'export CSV ne se limite plus a une ligne de totaux).
export async function getAccountingReportOperations(reportId: string) {
  await requireAccountingUser();
  const report = await db.accountingReport.findUnique({ where: { id: reportId } });
  if (!report) throw new Error("Bilan introuvable.");

  const f: any = report.filters || {};
  const where: any = {
    session: { is: { date: { gte: report.dateFrom, lte: report.dateTo } } },
    type: { in: report.operationTypes?.length ? report.operationTypes : ["INCOME", "EXPENSE", "CORRECTION"] },
  };
  if (f.categoryIds?.length) where.categoryId = { in: f.categoryIds };
  if (f.riderIds?.length) where.riderId = { in: f.riderIds };
  if (f.customerIds?.length) where.customerId = { in: f.customerIds };
  if (f.sessionIds?.length) where.sessionId = { in: f.sessionIds };
  if (f.source && f.source !== "ALL") where.source = f.source;

  const operations = await db.accountingOperation.findMany({
    where,
    include: { category: true, session: { select: { date: true } } },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  return JSON.parse(JSON.stringify(operations.map((op: any) => ({
    date: op.session.date,
    type: op.type,
    source: op.source,
    categoryName: op.category?.name || null,
    description: op.description || null,
    riderName: op.riderName || null,
    clientName: op.clientName || null,
    amount: op.amount,
  }))));
}
