-- 온톨로지: 일지 ↔ 목표(KPI/중점과제) 분류 태그 (AI 배치 + 본인 분류 공용)
CREATE TABLE IF NOT EXISTS "WorklogGoalTag" (
  "id" TEXT NOT NULL,
  "worklogId" TEXT NOT NULL,
  "goalType" TEXT NOT NULL,
  "goalId" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'AI',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorklogGoalTag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorklogGoalTag_worklogId_goalType_goalId_key" ON "WorklogGoalTag"("worklogId", "goalType", "goalId");
CREATE INDEX IF NOT EXISTS "WorklogGoalTag_goalType_goalId_idx" ON "WorklogGoalTag"("goalType", "goalId");
CREATE INDEX IF NOT EXISTS "WorklogGoalTag_worklogId_idx" ON "WorklogGoalTag"("worklogId");
