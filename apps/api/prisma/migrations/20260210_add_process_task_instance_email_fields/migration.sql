ALTER TABLE "ProcessTaskInstance" ADD COLUMN IF NOT EXISTS "emailTo" TEXT;
ALTER TABLE "ProcessTaskInstance" ADD COLUMN IF NOT EXISTS "emailCc" TEXT;
ALTER TABLE "ProcessTaskInstance" ADD COLUMN IF NOT EXISTS "emailSubject" TEXT;
ALTER TABLE "ProcessTaskInstance" ADD COLUMN IF NOT EXISTS "emailBody" TEXT;
