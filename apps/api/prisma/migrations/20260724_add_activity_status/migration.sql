ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'AUTO';
CREATE INDEX IF NOT EXISTS "Activity_status_idx" ON "Activity"("status");
