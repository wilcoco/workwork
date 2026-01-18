-- Add Teams UPN (email) field to User for Teams notification mapping

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "teamsUpn" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_teamsUpn_key" ON "User"("teamsUpn");
