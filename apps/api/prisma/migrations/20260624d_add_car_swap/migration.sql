-- 차량 교환 요청
CREATE TABLE IF NOT EXISTS "CarSwapRequest" (
  "id" TEXT NOT NULL,
  "fromDispatchId" TEXT NOT NULL,
  "toDispatchId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarSwapRequest_pkey" PRIMARY KEY ("id")
);
