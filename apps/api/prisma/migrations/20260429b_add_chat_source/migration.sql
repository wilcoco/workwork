-- AlterTable
ALTER TABLE "CompanyDataChat" ADD COLUMN IF NOT EXISTS "source" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompanyDataChat_source_idx" ON "CompanyDataChat"("source");
