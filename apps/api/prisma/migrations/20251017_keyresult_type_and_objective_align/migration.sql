-- Add KeyResultType enum and KeyResult.type
DO $$ BEGIN
  CREATE TYPE "KeyResultType" AS ENUM ('PROJECT','OPERATIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "type" "KeyResultType" NOT NULL DEFAULT 'PROJECT';

-- Add Objective.alignsToKrId
ALTER TABLE "Objective" ADD COLUMN IF NOT EXISTS "alignsToKrId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Objective" ADD CONSTRAINT "Objective_alignsToKr_fkey"
    FOREIGN KEY ("alignsToKrId") REFERENCES "KeyResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Objective_alignsToKr_idx" ON "Objective"("alignsToKrId");
