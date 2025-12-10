-- Create KeyResultAssignment table to link KPI key results to participating users (idempotent)
CREATE TABLE IF NOT EXISTS "KeyResultAssignment" (
    "id" TEXT NOT NULL,
    "keyResultId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeyResultAssignment_pkey" PRIMARY KEY ("id")
);

-- FKs (only if constraints missing)
DO $$ BEGIN
  ALTER TABLE "KeyResultAssignment" ADD CONSTRAINT "KeyResultAssignment_keyResultId_fkey"
    FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "KeyResultAssignment" ADD CONSTRAINT "KeyResultAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
