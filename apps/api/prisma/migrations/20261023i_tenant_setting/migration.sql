CREATE TABLE IF NOT EXISTS "TenantSetting" (
  "key" TEXT NOT NULL, "value" JSONB NOT NULL, "updatedById" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantSetting_pkey" PRIMARY KEY ("key")
);
