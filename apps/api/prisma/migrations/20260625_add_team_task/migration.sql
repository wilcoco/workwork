-- 팀 과제 관리 (재귀 트리)
CREATE TABLE IF NOT EXISTS "TeamTaskNode" (
  "id" TEXT NOT NULL,
  "orgUnitId" TEXT NOT NULL,
  "parentId" TEXT,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "milestoneDate" TIMESTAMP(3),
  "status" TEXT,
  "prepNote" TEXT,
  "resultNote" TEXT,
  "attachments" JSONB,
  "keyResultId" TEXT,
  "objectiveId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamTaskNode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TeamTaskNode_orgUnitId_idx" ON "TeamTaskNode"("orgUnitId");
CREATE INDEX IF NOT EXISTS "TeamTaskNode_parentId_idx" ON "TeamTaskNode"("parentId");
DO $$ BEGIN
  ALTER TABLE "TeamTaskNode" ADD CONSTRAINT "TeamTaskNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TeamTaskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 팀 과제 공개 설정
CREATE TABLE IF NOT EXISTS "TeamTaskSetting" (
  "orgUnitId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamTaskSetting_pkey" PRIMARY KEY ("orgUnitId")
);
