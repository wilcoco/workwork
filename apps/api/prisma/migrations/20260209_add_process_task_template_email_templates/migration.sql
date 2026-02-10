ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "emailToTemplate" TEXT;
ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "emailCcTemplate" TEXT;
ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "emailSubjectTemplate" TEXT;
ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "emailBodyTemplate" TEXT;
