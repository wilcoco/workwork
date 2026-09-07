ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "oracleSync" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "oracleSyncedAt" TIMESTAMP(3);
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "oracleSeq" INTEGER;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "oracleError" TEXT;
CREATE INDEX IF NOT EXISTS "CarDispatchRequest_oracleSync_idx" ON "CarDispatchRequest"("oracleSync");
