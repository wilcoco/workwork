ALTER TABLE "WorkManual" ADD COLUMN "authorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkManual" ADD COLUMN "authorTeamName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkManual" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkManual" ADD COLUMN "versionUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "WorkManual" m
SET
  "authorName" = COALESCE(u."name", ''),
  "authorTeamName" = COALESCE(ou."name", ''),
  "versionUpAt" = COALESCE(m."updatedAt", m."createdAt")
FROM "User" u
LEFT JOIN "OrgUnit" ou ON ou."id" = u."orgUnitId"
WHERE m."userId" = u."id";

CREATE INDEX "WorkManual_versionUpAt_idx" ON "WorkManual"("versionUpAt");
