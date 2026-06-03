ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "lastDeliveryAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastDeliveryAttemptRiderId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastDeliveryAttemptRiderName" TEXT,
  ADD COLUMN IF NOT EXISTS "lastDeliveryAttemptStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "lastDeliveryAttemptReason" TEXT;

CREATE INDEX IF NOT EXISTS "Order_lastDeliveryAttemptAt_idx"
  ON "Order"("lastDeliveryAttemptAt");

CREATE INDEX IF NOT EXISTS "Order_lastDeliveryAttemptRiderId_idx"
  ON "Order"("lastDeliveryAttemptRiderId");
