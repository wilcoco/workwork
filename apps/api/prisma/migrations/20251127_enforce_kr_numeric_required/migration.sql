-- Ensure data is valid before adding NOT NULL constraints
-- Fill any existing NULLs with safe defaults
UPDATE "KeyResult" SET "target" = 0 WHERE "target" IS NULL;
UPDATE "KeyResult" SET "unit" = '-' WHERE "unit" IS NULL;

-- Enforce NOT NULL constraints on KeyResult.target and KeyResult.unit
ALTER TABLE "KeyResult" ALTER COLUMN "target" SET NOT NULL;
ALTER TABLE "KeyResult" ALTER COLUMN "unit" SET NOT NULL;

