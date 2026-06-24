-- 경비실 긴급(직접) 배차 등록: 운전자명 + 긴급등록 플래그
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "driverName" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "guardCreated" BOOLEAN NOT NULL DEFAULT false;
