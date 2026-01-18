-- Add indexes for Worklog stats/detail queries

CREATE INDEX IF NOT EXISTS "Worklog_date_idx" ON "Worklog"("date");
CREATE INDEX IF NOT EXISTS "Worklog_createdAt_idx" ON "Worklog"("createdAt");
CREATE INDEX IF NOT EXISTS "Worklog_createdById_date_idx" ON "Worklog"("createdById", "date");
CREATE INDEX IF NOT EXISTS "Worklog_createdById_createdAt_idx" ON "Worklog"("createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "Worklog_visibility_date_idx" ON "Worklog"("visibility", "date");
