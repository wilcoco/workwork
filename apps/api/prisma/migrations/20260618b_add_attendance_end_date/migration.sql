-- 근태신청 기간(종료일) 컬럼 — 휴가/육아휴직 등 연속 기간을 한 건(단일 결재)으로 신청
ALTER TABLE "AttendanceRequest" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
