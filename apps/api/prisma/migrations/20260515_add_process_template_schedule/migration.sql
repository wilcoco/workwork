-- Add schedule fields to ProcessTemplate
ALTER TABLE "ProcessTemplate"
  ADD COLUMN "scheduleEnabled"   BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN "scheduleNextRunAt" TIMESTAMP(3),
  ADD COLUMN "scheduleLastRunAt" TIMESTAMP(3);
