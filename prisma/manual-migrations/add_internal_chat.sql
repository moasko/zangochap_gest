DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatMessageScope') THEN
    CREATE TYPE "ChatMessageScope" AS ENUM ('GENERAL', 'ROLE', 'DIRECT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  "id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "scope" "ChatMessageScope" NOT NULL DEFAULT 'GENERAL',
  "targetRole" "Role",
  "recipientId" TEXT,
  "senderId" TEXT,
  "senderName" TEXT NOT NULL,
  "senderRole" "Role" NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "editedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "ChatMessage"
  ALTER COLUMN "senderId" DROP NOT NULL;

ALTER TABLE "ChatMessage"
  DROP CONSTRAINT IF EXISTS "ChatMessage_senderId_fkey";

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ChatRead" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatRead_messageId_userId_key"
  ON "ChatRead"("messageId", "userId");

CREATE INDEX IF NOT EXISTS "ChatMessage_scope_idx" ON "ChatMessage"("scope");
CREATE INDEX IF NOT EXISTS "ChatMessage_targetRole_idx" ON "ChatMessage"("targetRole");
CREATE INDEX IF NOT EXISTS "ChatMessage_recipientId_idx" ON "ChatMessage"("recipientId");
CREATE INDEX IF NOT EXISTS "ChatMessage_senderId_idx" ON "ChatMessage"("senderId");
CREATE INDEX IF NOT EXISTS "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_deletedAt_idx" ON "ChatMessage"("deletedAt");
CREATE INDEX IF NOT EXISTS "ChatRead_userId_idx" ON "ChatRead"("userId");
CREATE INDEX IF NOT EXISTS "ChatRead_readAt_idx" ON "ChatRead"("readAt");
