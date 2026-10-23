CREATE TABLE IF NOT EXISTS "OpsMetricDaily" (
  "id" TEXT NOT NULL, "date" TEXT NOT NULL, "score" DOUBLE PRECISION NOT NULL, "grade" INTEGER NOT NULL,
  "components" JSONB NOT NULL, "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsMetricDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsMetricDaily_date_key" ON "OpsMetricDaily"("date");
