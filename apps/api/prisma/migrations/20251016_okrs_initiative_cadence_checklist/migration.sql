-- Enums
DO $$ BEGIN
  CREATE TYPE "InitiativeType" AS ENUM ('PROJECT','OPERATIONAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "Cadence" AS ENUM ('DAILY','WEEKLY','MONTHLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Initiative extensions
ALTER TABLE "Initiative"
  ADD COLUMN IF NOT EXISTS "type" "InitiativeType" NOT NULL DEFAULT 'PROJECT',
  ADD COLUMN IF NOT EXISTS "startAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cadence" "Cadence",
  ADD COLUMN IF NOT EXISTS "cadenceAnchor" TEXT;

-- Checklist tables
CREATE TABLE IF NOT EXISTS "ChecklistItem" (
  "id" TEXT NOT NULL,
  "initiativeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChecklistItem_initiative_fkey" FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChecklistItem_initiative_idx" ON "ChecklistItem"("initiativeId");

CREATE TABLE IF NOT EXISTS "ChecklistTick" (
  "id" TEXT NOT NULL,
  "checklistItemId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  CONSTRAINT "ChecklistTick_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChecklistTick_item_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChecklistTick_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChecklistTick_item_idx" ON "ChecklistTick"("checklistItemId");
CREATE INDEX IF NOT EXISTS "ChecklistTick_period_idx" ON "ChecklistTick"("periodStart","periodEnd");
