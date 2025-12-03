-- AlterEnum: add QUARTERLY to existing Cadence enum (idempotent)
DO $$ BEGIN
  ALTER TYPE "Cadence" ADD VALUE IF NOT EXISTS 'QUARTERLY';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: ProgressEntry
CREATE TABLE IF NOT EXISTS "ProgressEntry" (
    "id" TEXT NOT NULL,
    "worklogId" TEXT,
    "actorId" TEXT NOT NULL,
    "keyResultId" TEXT,
    "initiativeId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "krValue" DOUBLE PRECISION,
    "initiativeDone" BOOLEAN,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- FKs (only if table exists and constraints missing)
DO $$ BEGIN
  ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_worklogId_fkey"
    FOREIGN KEY ("worklogId") REFERENCES "Worklog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_keyResultId_fkey"
    FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_initiativeId_fkey"
    FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

