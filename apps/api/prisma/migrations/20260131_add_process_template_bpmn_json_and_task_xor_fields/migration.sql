ALTER TABLE "ProcessTemplate" ADD COLUMN IF NOT EXISTS "bpmnJson" JSONB;

ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "predecessorMode" TEXT;
ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "xorGroupKey" TEXT;
ALTER TABLE "ProcessTaskTemplate" ADD COLUMN IF NOT EXISTS "xorCondition" TEXT;
