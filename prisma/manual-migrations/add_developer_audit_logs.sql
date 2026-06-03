CREATE TABLE IF NOT EXISTS "DeveloperAuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "actorEmail" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeveloperAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeveloperAuditLog_action_idx"
  ON "DeveloperAuditLog"("action");

CREATE INDEX IF NOT EXISTS "DeveloperAuditLog_status_idx"
  ON "DeveloperAuditLog"("status");

CREATE INDEX IF NOT EXISTS "DeveloperAuditLog_createdAt_idx"
  ON "DeveloperAuditLog"("createdAt");
