-- Add tags JSON field to Worklog, HelpTicket, ApprovalRequest
-- Tags store: itemCode, moldCode, carModelCode, supplierCode
-- ProcessInstance already has itemCode, moldCode, carModelCode - just add supplierCode

ALTER TABLE "Worklog" ADD COLUMN IF NOT EXISTS "tags" JSONB;
ALTER TABLE "HelpTicket" ADD COLUMN IF NOT EXISTS "tags" JSONB;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "tags" JSONB;
ALTER TABLE "ProcessInstance" ADD COLUMN IF NOT EXISTS "supplierCode" TEXT;

-- Create Supplier master table
CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_code_key" ON "Supplier"("code");

-- Create Equipment master table
CREATE TABLE IF NOT EXISTS "Equipment" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Equipment_code_key" ON "Equipment"("code");
