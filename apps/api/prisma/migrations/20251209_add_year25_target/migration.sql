-- Add year25Target column to KeyResult (idempotent)
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "year25Target" DOUBLE PRECISION;
