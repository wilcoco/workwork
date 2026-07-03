-- 결재 목록 조회 성능 개선: 결재자/신청자/상태 기준 인덱스 (기존엔 인덱스 없어 풀 스캔)
CREATE INDEX IF NOT EXISTS "ApprovalRequest_approverId_status_idx" ON "ApprovalRequest"("approverId", "status");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_requestedById_status_idx" ON "ApprovalRequest"("requestedById", "status");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");

-- 다단계 결재: steps.some(approverId) 서브쿼리 및 관계 조인 가속
CREATE INDEX IF NOT EXISTS "ApprovalStep_approverId_status_idx" ON "ApprovalStep"("approverId", "status");
CREATE INDEX IF NOT EXISTS "ApprovalStep_requestId_idx" ON "ApprovalStep"("requestId");
