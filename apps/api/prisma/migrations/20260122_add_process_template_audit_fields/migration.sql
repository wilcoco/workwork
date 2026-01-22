-- Add audit fields to ProcessTemplate for creator/editor tracking
ALTER TABLE "ProcessTemplate" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "ProcessTemplate" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

-- Backfill existing rows using ownerId
UPDATE "ProcessTemplate" SET "createdById" = "ownerId" WHERE "createdById" IS NULL;
UPDATE "ProcessTemplate" SET "updatedById" = "ownerId" WHERE "updatedById" IS NULL;

-- Enforce not-null
ALTER TABLE "ProcessTemplate" ALTER COLUMN "createdById" SET NOT NULL;
ALTER TABLE "ProcessTemplate" ALTER COLUMN "updatedById" SET NOT NULL;

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
