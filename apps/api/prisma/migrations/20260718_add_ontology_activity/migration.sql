-- 온톨로지 1단계: 활동(Activity) 등록부 + 각 모듈 연결 컬럼
CREATE TABLE IF NOT EXISTS "Activity" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normName" TEXT NOT NULL,
  "taskType" TEXT,
  "description" TEXT,
  "aliases" JSONB,
  "roleHint" TEXT,
  "criteria" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Activity_normName_key" ON "Activity"("normName");
CREATE INDEX IF NOT EXISTS "Activity_name_idx" ON "Activity"("name");
CREATE INDEX IF NOT EXISTS "Activity_taskType_idx" ON "Activity"("taskType");

ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "activityId" TEXT;
ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "activityId" TEXT;
CREATE INDEX IF NOT EXISTS "Worklog_activityId_idx" ON "Worklog"("activityId");
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "activityId" TEXT;
ALTER TABLE "KeyInitiative" ADD COLUMN IF NOT EXISTS "activityId" TEXT;
