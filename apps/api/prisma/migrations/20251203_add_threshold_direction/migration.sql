-- Add ThresholdDirection enum and direction column to KeyResult
DO $$ BEGIN
  CREATE TYPE "ThresholdDirection" AS ENUM ('AT_LEAST', 'AT_MOST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "direction" "ThresholdDirection";
