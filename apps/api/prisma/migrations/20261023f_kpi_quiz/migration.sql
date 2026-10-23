ALTER TABLE "KpiBinding" ADD COLUMN IF NOT EXISTS "quizEnabled" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS "KpiQuiz" (
  "id" TEXT NOT NULL, "keyResultId" TEXT NOT NULL, "year" INTEGER NOT NULL, "month" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN', "respondentId" TEXT NOT NULL,
  "questions" JSONB NOT NULL, "dataSnapshot" JSONB NOT NULL,
  "answers" JSONB, "answeredAt" TIMESTAMP(3), "aiGrading" JSONB, "aiScore" DOUBLE PRECISION, "finalScore" DOUBLE PRECISION,
  "gradedById" TEXT, "gradedAt" TIMESTAMP(3), "gradeNote" TEXT, "dueAt" TIMESTAMP(3) NOT NULL, "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KpiQuiz_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KpiQuiz_keyResultId_year_month_key" ON "KpiQuiz"("keyResultId", "year", "month");
CREATE INDEX IF NOT EXISTS "KpiQuiz_respondentId_status_idx" ON "KpiQuiz"("respondentId", "status");
