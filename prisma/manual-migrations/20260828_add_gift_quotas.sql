-- Production : sauvegarder la base puis exécuter explicitement ce script.
-- Il n'est jamais exécuté automatiquement par l'application.
DO $$ BEGIN
  CREATE TYPE "GiftApprovalStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "giftMonthlyQuota" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "giftMonthlyValueQuota" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "giftCountsTowardQuota" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "giftUnitValue" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "giftApprovalStatus" "GiftApprovalStatus";

-- Les cadeaux déjà présents avant cette fonctionnalité restent autorisés et
-- ne sont pas débités rétroactivement du quota du mois courant.
UPDATE "OrderItem"
SET "giftApprovalStatus" = 'APPROVED',
    "giftCountsTowardQuota" = FALSE
WHERE "isGift" = TRUE
  AND "giftApprovalStatus" IS NULL;

CREATE TABLE IF NOT EXISTS "GiftApprovalRequest" (
  "id" TEXT NOT NULL,
  "commercialId" TEXT NOT NULL,
  "commercialName" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderRef" TEXT,
  "orderItemId" TEXT NOT NULL,
  "giftName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitValue" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "status" "GiftApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedByName" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GiftApprovalRequest_orderItemId_key" ON "GiftApprovalRequest"("orderItemId");
CREATE INDEX IF NOT EXISTS "GiftApprovalRequest_commercialId_createdAt_idx" ON "GiftApprovalRequest"("commercialId", "createdAt");
CREATE INDEX IF NOT EXISTS "GiftApprovalRequest_status_createdAt_idx" ON "GiftApprovalRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "GiftApprovalRequest_orderId_idx" ON "GiftApprovalRequest"("orderId");
