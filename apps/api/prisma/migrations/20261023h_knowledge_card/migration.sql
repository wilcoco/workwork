ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "kcScannedAt" TIMESTAMP(3);
ALTER TABLE "WorkManual" ADD COLUMN IF NOT EXISTS "kcScannedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "KnowledgeCard" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "normTitle" TEXT NOT NULL, "symptom" TEXT NOT NULL, "checks" JSONB NOT NULL, "action" TEXT NOT NULL,
  "tags" JSONB, "sourceType" TEXT NOT NULL, "sourceId" TEXT, "sourceExcerpt" TEXT, "activityId" TEXT, "keyResultId" TEXT, "orgUnitId" TEXT,
  "ownerId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT', "confidence" INTEGER NOT NULL DEFAULT 0, "confirmedById" TEXT, "confirmedAt" TIMESTAMP(3),
  "useCount" INTEGER NOT NULL DEFAULT 0, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeCard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeCard_status_orgUnitId_idx" ON "KnowledgeCard"("status", "orgUnitId");
CREATE INDEX IF NOT EXISTS "KnowledgeCard_activityId_idx" ON "KnowledgeCard"("activityId");
CREATE INDEX IF NOT EXISTS "KnowledgeCard_normTitle_idx" ON "KnowledgeCard"("normTitle");
