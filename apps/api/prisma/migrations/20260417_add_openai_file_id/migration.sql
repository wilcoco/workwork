-- AlterTable (idempotent — column may already exist from combined migration)
ALTER TABLE "CompanyData" ADD COLUMN IF NOT EXISTS "openaiFileId" TEXT;
