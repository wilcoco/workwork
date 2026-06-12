-- 프로세스 템플릿에 출처 매뉴얼 연결 (매뉴얼 → 프로세스 추적)
ALTER TABLE "ProcessTemplate" ADD COLUMN "sourceManualId" TEXT;
