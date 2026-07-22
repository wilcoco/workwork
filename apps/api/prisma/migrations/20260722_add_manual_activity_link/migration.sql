ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "activityId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkManual_activityId_idx" ON "WorkManual"("activityId");
