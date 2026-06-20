-- Add the Comptabilite module: role, sessions, categories, operations, reports and audit trail.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMPTABLE';

CREATE TYPE "AccountingOperationType" AS ENUM ('INCOME', 'EXPENSE', 'CORRECTION');
CREATE TYPE "AccountingOperationSource" AS ENUM ('DELIVERY', 'CUSTOMER', 'MANUAL', 'OTHER');
CREATE TYPE "AccountingCategoryType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "AccountingSessionStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "AccountingSession" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "status" "AccountingSessionStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "type" "AccountingCategoryType" NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingOperation" (
  "id" TEXT NOT NULL,
  "type" "AccountingOperationType" NOT NULL,
  "source" "AccountingOperationSource" NOT NULL DEFAULT 'MANUAL',
  "amount" INTEGER NOT NULL,
  "originalAmount" INTEGER,
  "description" TEXT,
  "proofUrl" TEXT,
  "reason" TEXT,
  "sessionId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "deliveryOrderId" TEXT,
  "deliveryOrderRef" TEXT,
  "customerId" TEXT,
  "clientName" TEXT,
  "riderId" TEXT,
  "riderName" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT,
  "updatedById" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingAuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "sessionId" TEXT,
  "operationId" TEXT,
  "actorId" TEXT,
  "actorName" TEXT,
  "actorEmail" TEXT,
  "previousAmount" INTEGER,
  "newAmount" INTEGER,
  "reason" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingReport" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "dateFrom" TIMESTAMP(3) NOT NULL,
  "dateTo" TIMESTAMP(3) NOT NULL,
  "operationTypes" TEXT[],
  "filters" JSONB,
  "totalIncome" INTEGER NOT NULL DEFAULT 0,
  "totalExpense" INTEGER NOT NULL DEFAULT 0,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "operationsCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "_AccountingReportCategories" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

CREATE TABLE "_AccountingReportSessions" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "AccountingSession_date_key" ON "AccountingSession"("date");
CREATE INDEX "AccountingSession_date_idx" ON "AccountingSession"("date");
CREATE INDEX "AccountingSession_status_idx" ON "AccountingSession"("status");
CREATE UNIQUE INDEX "AccountingCategory_slug_type_key" ON "AccountingCategory"("slug", "type");
CREATE INDEX "AccountingCategory_type_idx" ON "AccountingCategory"("type");
CREATE UNIQUE INDEX "AccountingOperation_source_deliveryOrderId_key" ON "AccountingOperation"("source", "deliveryOrderId");
CREATE INDEX "AccountingOperation_sessionId_idx" ON "AccountingOperation"("sessionId");
CREATE INDEX "AccountingOperation_categoryId_idx" ON "AccountingOperation"("categoryId");
CREATE INDEX "AccountingOperation_type_idx" ON "AccountingOperation"("type");
CREATE INDEX "AccountingOperation_source_idx" ON "AccountingOperation"("source");
CREATE INDEX "AccountingOperation_customerId_idx" ON "AccountingOperation"("customerId");
CREATE INDEX "AccountingOperation_createdAt_idx" ON "AccountingOperation"("createdAt");
CREATE INDEX "AccountingAuditLog_entityType_entityId_idx" ON "AccountingAuditLog"("entityType", "entityId");
CREATE INDEX "AccountingAuditLog_sessionId_idx" ON "AccountingAuditLog"("sessionId");
CREATE INDEX "AccountingAuditLog_operationId_idx" ON "AccountingAuditLog"("operationId");
CREATE INDEX "AccountingAuditLog_createdAt_idx" ON "AccountingAuditLog"("createdAt");
CREATE INDEX "AccountingReport_dateFrom_dateTo_idx" ON "AccountingReport"("dateFrom", "dateTo");
CREATE INDEX "AccountingReport_createdAt_idx" ON "AccountingReport"("createdAt");
CREATE UNIQUE INDEX "_AccountingReportCategories_AB_unique" ON "_AccountingReportCategories"("A", "B");
CREATE INDEX "_AccountingReportCategories_B_index" ON "_AccountingReportCategories"("B");
CREATE UNIQUE INDEX "_AccountingReportSessions_AB_unique" ON "_AccountingReportSessions"("A", "B");
CREATE INDEX "_AccountingReportSessions_B_index" ON "_AccountingReportSessions"("B");

ALTER TABLE "AccountingOperation" ADD CONSTRAINT "AccountingOperation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AccountingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingOperation" ADD CONSTRAINT "AccountingOperation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountingCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingAuditLog" ADD CONSTRAINT "AccountingAuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AccountingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingAuditLog" ADD CONSTRAINT "AccountingAuditLog_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "AccountingOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "_AccountingReportCategories" ADD CONSTRAINT "_AccountingReportCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "AccountingCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AccountingReportCategories" ADD CONSTRAINT "_AccountingReportCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "AccountingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AccountingReportSessions" ADD CONSTRAINT "_AccountingReportSessions_A_fkey" FOREIGN KEY ("A") REFERENCES "AccountingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AccountingReportSessions" ADD CONSTRAINT "_AccountingReportSessions_B_fkey" FOREIGN KEY ("B") REFERENCES "AccountingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AccountingCategory" ("id", "name", "slug", "type", "isDefault", "updatedAt")
VALUES
  ('acc-cat-income-delivery', 'Paiement livraison', 'paiement-livraison', 'INCOME', true, CURRENT_TIMESTAMP),
  ('acc-cat-income-client-payment', 'Reglement client', 'reglement-client', 'INCOME', true, CURRENT_TIMESTAMP),
  ('acc-cat-income-client-advance', 'Avance client', 'avance-client', 'INCOME', true, CURRENT_TIMESTAMP),
  ('acc-cat-income-direct-sale', 'Vente directe', 'vente-directe', 'INCOME', true, CURRENT_TIMESTAMP),
  ('acc-cat-income-other', 'Autre entree', 'autre-entree', 'INCOME', true, CURRENT_TIMESTAMP),
  ('acc-cat-expense-transport', 'Transport', 'transport', 'EXPENSE', true, CURRENT_TIMESTAMP),
  ('acc-cat-expense-fuel', 'Carburant', 'carburant', 'EXPENSE', true, CURRENT_TIMESTAMP),
  ('acc-cat-expense-equipment', 'Achat materiel', 'achat-materiel', 'EXPENSE', true, CURRENT_TIMESTAMP),
  ('acc-cat-expense-salary', 'Salaire', 'salaire', 'EXPENSE', true, CURRENT_TIMESTAMP),
  ('acc-cat-expense-rider-commission', 'Commission livreur', 'commission-livreur', 'EXPENSE', true, CURRENT_TIMESTAMP),
  ('acc-cat-expense-other', 'Depense diverse', 'depense-diverse', 'EXPENSE', true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug", "type") DO NOTHING;
