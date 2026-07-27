-- KPI 누적 집계 방식: AVG(월별 독립 측정=평균) | SUM(월별 발생량=합산) | LAST(누계값 입력=최신값)
ALTER TABLE "KeyResult" ADD COLUMN IF NOT EXISTS "aggregation" TEXT;
