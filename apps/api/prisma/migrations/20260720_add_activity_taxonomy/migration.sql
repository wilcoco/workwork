-- 온톨로지 체계화: 활동 대분류(domain)/중분류(category)
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "domain" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "category" TEXT;
CREATE INDEX IF NOT EXISTS "Activity_domain_idx" ON "Activity"("domain");
