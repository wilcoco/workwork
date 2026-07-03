-- 입출입 기록 시각(KST 9시간 오차) 일회성 소급 보정
--
-- 배경: KT텔레캅/에스원/캡스 입출입 기록은 오프셋 없는 KST 벽시계 문자열로 들어오는데,
-- 기존 코드가 new Date()로 UTC로 잘못 해석해 실제보다 9시간 앞으로 저장했다.
-- (수집 로직은 커밋 85c00f4에서 parseKstDate 적용으로 수정됨)
--
-- 안전장치: 수정 커밋 시각(UTC 2026-07-03 07:41:15) 이전에 동기화된 행만 대상으로 한다.
-- eventAt/syncedAt은 Prisma 기본 timestamp(3) = UTC naive 로 저장되므로 오프셋 없는 UTC 리터럴로 비교.
-- 이렇게 하면 수정 배포 이후 정상 저장된 행은 절대 건드리지 않는다(과잉 보정 방지).

UPDATE "KtAccessLog" SET "eventAt" = "eventAt" - INTERVAL '9 hours' WHERE "syncedAt" < '2026-07-03 07:41:15';
UPDATE "SecomAlarm"  SET "eventAt" = "eventAt" - INTERVAL '9 hours' WHERE "syncedAt" < '2026-07-03 07:41:15';
UPDATE "CapsAlarm"   SET "eventAt" = "eventAt" - INTERVAL '9 hours' WHERE "syncedAt" < '2026-07-03 07:41:15';
