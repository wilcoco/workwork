-- 법인차량 입·출차 관리 + 사용 후 등록(차량상태/적산거리 사진, 주행거리) 컬럼
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "checkoutAt" TIMESTAMP(3);
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "checkinAt" TIMESTAMP(3);
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "checkedOutById" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "checkedInById" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerStart" INTEGER;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerEnd" INTEGER;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "distanceKm" INTEGER;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "statusPhotos" JSONB;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerPhotos" JSONB;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "usageNote" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "usageRegisteredAt" TIMESTAMP(3);
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "usageRegisteredById" TEXT;
