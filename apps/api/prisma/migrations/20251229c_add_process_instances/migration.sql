-- Create tables for process instances and task instances

CREATE TABLE "ProcessInstance" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "templateId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startedById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startAt" TIMESTAMP NOT NULL DEFAULT now(),
  "endAt" TIMESTAMP,
  "expectedEndAt" TIMESTAMP,
  "itemCode" TEXT,
  "moldCode" TEXT,
  "carModelCode" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcessTaskInstance" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "instanceId" TEXT NOT NULL,
  "taskTemplateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stageLabel" TEXT,
  "taskType" "TaskType" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "plannedStartAt" TIMESTAMP,
  "plannedEndAt" TIMESTAMP,
  "actualStartAt" TIMESTAMP,
  "actualEndAt" TIMESTAMP,
  "deadlineAt" TIMESTAMP,
  "worklogId" TEXT,
  "cooperationId" TEXT,
  "approvalRequestId" TEXT,
  "assigneeId" TEXT,
  "decidedById" TEXT,
  "decisionReason" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "ProcessTaskInstance" ADD CONSTRAINT "ProcessTaskInstance_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ProcessInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessTaskInstance" ADD CONSTRAINT "ProcessTaskInstance_taskTemplateId_fkey" FOREIGN KEY ("taskTemplateId") REFERENCES "ProcessTaskTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
