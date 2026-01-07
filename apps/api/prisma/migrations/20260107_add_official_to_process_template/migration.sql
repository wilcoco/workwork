-- Add 'official' flag to ProcessTemplate (idempotent)
ALTER TABLE "ProcessTemplate" ADD COLUMN IF NOT EXISTS "official" BOOLEAN NOT NULL DEFAULT false;
