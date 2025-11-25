-- Create Pillar enum
DO $$ BEGIN
  CREATE TYPE "Pillar" AS ENUM ('Q','C','D','DEV','P');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add pillar to Objective
ALTER TABLE "Objective" ADD COLUMN IF NOT EXISTS "pillar" "Pillar";

-- Add pillar/baseline/cadence to KeyResult
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "pillar" "Pillar";
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "baseline" DOUBLE PRECISION;
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "cadence" "Cadence";
