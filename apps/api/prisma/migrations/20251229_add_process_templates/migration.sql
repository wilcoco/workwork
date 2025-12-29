-- Create enums and tables for process templates and task templates

CREATE TYPE "ProcessType" AS ENUM ('RECURRING', 'PROJECT');
CREATE TYPE "ProcessVisibility" AS ENUM ('PUBLIC', 'ORG_UNIT', 'PRIVATE');
CREATE TYPE "TaskType" AS ENUM ('COOPERATION', 'WORKLOG', 'APPROVAL', 'TASK');
CREATE TYPE "AssigneeType" AS ENUM ('USER', 'ORG_UNIT', 'ROLE');
CREATE TYPE "ApprovalRouteType" AS ENUM ('ORG_CHART', 'ROLE_BASED', 'CUSTOM_USERS');

CREATE TABLE "ProcessTemplate" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "ProcessType" NOT NULL DEFAULT 'PROJECT',
  "ownerId" TEXT NOT NULL,
  "visibility" "ProcessVisibility" NOT NULL DEFAULT 'PUBLIC',
  "orgUnitId" TEXT,
  "recurrenceType" TEXT,
  "recurrenceDetail" TEXT,
  "resultInputRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "expectedDurationDays" INTEGER,
  "expectedCompletionCriteria" TEXT,
  "allowExtendDeadline" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProcessTaskTemplate" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "processTemplateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "taskType" "TaskType" NOT NULL DEFAULT 'TASK',
  "orderHint" INTEGER NOT NULL DEFAULT 0,
  "predecessorIds" TEXT,
  "assigneeType" "AssigneeType",
  "assigneeUserId" TEXT,
  "assigneeOrgUnitId" TEXT,
  "assigneeRoleCode" TEXT,
  "cooperationTargetType" "AssigneeType",
  "cooperationTargetUserId" TEXT,
  "cooperationTargetOrgUnitId" TEXT,
  "cooperationTargetRoleCode" TEXT,
  "expectedOutput" TEXT,
  "worklogTemplateHint" TEXT,
  "linkToKpiType" TEXT,
  "approvalRouteType" "ApprovalRouteType",
  "approvalRoleCodes" TEXT,
  "approvalUserIds" TEXT,
  "isFinalApproval" BOOLEAN NOT NULL DEFAULT FALSE,
  "deadlineOffsetDays" INTEGER,
  "slaHours" INTEGER,
  "allowDelayReasonRequired" BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE "ProcessTaskTemplate" ADD CONSTRAINT "ProcessTaskTemplate_processTemplateId_fkey" FOREIGN KEY ("processTemplateId") REFERENCES "ProcessTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
