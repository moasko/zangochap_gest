-- À exécuter explicitement sur PostgreSQL avant de déployer cette fonctionnalité.
-- Ce script n'est pas exécuté automatiquement par l'application.
DO $$ BEGIN
  CREATE TYPE "PackingItemStatus" AS ENUM ('PENDING', 'PACKED', 'NOT_PACKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "OrderItem"
  ADD COLUMN "packingStatus" "PackingItemStatus" NOT NULL DEFAULT 'PENDING';
UPDATE "OrderItem"
SET "packingStatus" = 'PACKED'
WHERE "isVerified" = TRUE;
