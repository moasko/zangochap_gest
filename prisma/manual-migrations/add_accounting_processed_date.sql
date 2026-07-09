-- Date de traitement de la comptabilite : saisie manuellement a la cloture de la
-- session (le jour ou la caisse a ete reellement traitee/rapprochee, distinct du
-- jour comptable "date"). Nullable pour ne pas casser les sessions existantes.

ALTER TABLE "AccountingSession" ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3);
ALTER TABLE "AccountingSession" ADD COLUMN IF NOT EXISTS "processedByName" TEXT;
