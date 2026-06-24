-- 선점자와 협의한 추가/교환 배차
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "coUse" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "negotiatedWithId" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "negotiationStatus" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "negotiationNote" TEXT;
ALTER TABLE "CarDispatchRequest" ADD COLUMN IF NOT EXISTS "conflictDispatchId" TEXT;
