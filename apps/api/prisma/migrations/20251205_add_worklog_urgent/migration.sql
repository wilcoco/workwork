-- Add urgent flag to Worklog
ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "urgent" BOOLEAN NOT NULL DEFAULT FALSE;
