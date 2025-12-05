-- Add dueAt to HelpTicket for cooperation deadline
ALTER TABLE "HelpTicket" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);
