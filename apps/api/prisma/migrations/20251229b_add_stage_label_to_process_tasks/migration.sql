-- Add stageLabel to ProcessTaskTemplate for grouping/labeling stages

ALTER TABLE "ProcessTaskTemplate" ADD COLUMN "stageLabel" TEXT;
