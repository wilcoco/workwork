-- 업무일지 지식 배지: AI가 "훌륭한 업무 지식 정리"로 판정하면 부여, 랭킹/통계용
ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "kbBadge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "kbBadgeNote" TEXT;
CREATE INDEX IF NOT EXISTS "Worklog_kbBadge_date_idx" ON "Worklog"("kbBadge", "date");
