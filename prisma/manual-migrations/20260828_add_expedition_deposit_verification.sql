DO $$ BEGIN
  CREATE TYPE "DepositVerificationStatus" AS ENUM ('PENDING', 'RECEIVED', 'NOT_RECEIVED', 'CORRECTION_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "depositSenderPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "depositTransactionRef" TEXT,
  ADD COLUMN IF NOT EXISTS "depositVerificationStatus" "DepositVerificationStatus",
  ADD COLUMN IF NOT EXISTS "depositVerificationNote" TEXT,
  ADD COLUMN IF NOT EXISTS "depositVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "depositVerifiedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "depositAlertAcknowledgedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_depositVerificationStatus_idx"
  ON "Order"("depositVerificationStatus");
