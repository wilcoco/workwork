-- 온톨로지: 목표(KPI/중점과제) ↔ 활동 다중 연결 (1:N)
CREATE TABLE IF NOT EXISTS "GoalActivityLink" (
  "id" TEXT NOT NULL,
  "goalType" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalActivityLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoalActivityLink_goalType_goalId_activityId_key" ON "GoalActivityLink"("goalType", "goalId", "activityId");
CREATE INDEX IF NOT EXISTS "GoalActivityLink_activityId_idx" ON "GoalActivityLink"("activityId");
CREATE INDEX IF NOT EXISTS "GoalActivityLink_goalType_goalId_idx" ON "GoalActivityLink"("goalType", "goalId");

-- 백필: 기존 단일 링크(activityId 컬럼)를 조인 테이블로 복사 (idempotent)
INSERT INTO "GoalActivityLink" ("id", "goalType", "goalId", "activityId")
SELECT 'gal_' || md5('KR' || kr."id" || kr."activityId"), 'KR', kr."id", kr."activityId"
FROM "KeyResult" kr
WHERE kr."activityId" IS NOT NULL
ON CONFLICT ("goalType", "goalId", "activityId") DO NOTHING;

INSERT INTO "GoalActivityLink" ("id", "goalType", "goalId", "activityId")
SELECT 'gal_' || md5('KI' || ki."id" || ki."activityId"), 'KI', ki."id", ki."activityId"
FROM "KeyInitiative" ki
WHERE ki."activityId" IS NOT NULL
ON CONFLICT ("goalType", "goalId", "activityId") DO NOTHING;
