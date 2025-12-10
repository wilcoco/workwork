-- Add WorklogVisibility enum and visibility column to Worklog (idempotent-ish)
DO $$ BEGIN
  CREATE TYPE "WorklogVisibility" AS ENUM ('ALL','MANAGER_PLUS','EXEC_PLUS','CEO_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "visibility" "WorklogVisibility" NOT NULL DEFAULT 'ALL';
