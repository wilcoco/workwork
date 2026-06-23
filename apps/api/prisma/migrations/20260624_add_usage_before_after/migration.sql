-- 차량 사용 전/후 사진 및 인식 적산거리 컬럼
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "statusPhotosBefore" JSONB;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "statusPhotosAfter" JSONB;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerPhotosBefore" JSONB;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerPhotosAfter" JSONB;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerBeforeOcr" INTEGER;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "odometerAfterOcr" INTEGER;
