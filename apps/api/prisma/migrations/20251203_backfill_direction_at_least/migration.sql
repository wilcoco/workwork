-- Backfill KeyResult.direction for existing records
UPDATE "KeyResult" SET "direction" = 'AT_LEAST' WHERE "direction" IS NULL;
