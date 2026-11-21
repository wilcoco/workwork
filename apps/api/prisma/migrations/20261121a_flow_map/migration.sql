CREATE TABLE IF NOT EXISTS "ObservedTransition" (
  "id" TEXT NOT NULL, "month" TEXT NOT NULL, "level" TEXT NOT NULL DEFAULT 'DOMAIN',
  "fromKey" TEXT NOT NULL, "toKey" TEXT NOT NULL, "fromLabel" TEXT NOT NULL, "toLabel" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0, "ofCount" INTEGER NOT NULL DEFAULT 0,
  "confidence" TEXT NOT NULL DEFAULT 'LINKED', "defined" BOOLEAN NOT NULL DEFAULT false,
  "medianGapMinutes" INTEGER, "offHoursRatio" INTEGER, "sampleCases" JSONB,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservedTransition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ObservedTransition_month_level_fromKey_toKey_key" ON "ObservedTransition"("month","level","fromKey","toKey");
CREATE INDEX IF NOT EXISTS "ObservedTransition_month_defined_idx" ON "ObservedTransition"("month","defined");

CREATE TABLE IF NOT EXISTS "DeviationDecision" (
  "id" TEXT NOT NULL, "transitionId" TEXT NOT NULL, "choice" TEXT NOT NULL, "rationale" TEXT,
  "decidedById" TEXT NOT NULL, "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviationDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviationDecision_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "ObservedTransition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviationDecision_transitionId_key" ON "DeviationDecision"("transitionId");
