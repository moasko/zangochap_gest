-- A executer uniquement apres autorisation explicite du proprietaire.
-- Ajout de deux tables uniquement. Aucun UPDATE/DELETE sur les donnees existantes.
BEGIN;
CREATE TABLE "RiderTrackingState" (
  "riderId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stoppedAt" TIMESTAMP(3),
  "lastReceivedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3),
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION
);
CREATE TABLE "RiderLocationPoint" (
  "id" TEXT PRIMARY KEY,
  "riderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL CHECK ("latitude" BETWEEN -90 AND 90),
  "longitude" DOUBLE PRECISION NOT NULL CHECK ("longitude" BETWEEN -180 AND 180),
  "accuracy" DOUBLE PRECISION NOT NULL CHECK ("accuracy" >= 0 AND "accuracy" <= 100000),
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RiderLocationPoint_riderId_capturedAt_idx" ON "RiderLocationPoint"("riderId", "capturedAt");
CREATE INDEX "RiderLocationPoint_receivedAt_idx" ON "RiderLocationPoint"("receivedAt");
COMMIT;
