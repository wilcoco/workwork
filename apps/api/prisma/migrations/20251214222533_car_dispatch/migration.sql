-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "ChecklistTick" DROP CONSTRAINT "ChecklistTick_item_fkey";

-- DropForeignKey
ALTER TABLE "KeyResultAssignment" DROP CONSTRAINT "KeyResultAssignment_keyResultId_fkey";

-- DropForeignKey
ALTER TABLE "KeyResultAssignment" DROP CONSTRAINT "KeyResultAssignment_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserGoal" DROP CONSTRAINT "UserGoal_user_fkey";

-- DropIndex
DROP INDEX "ChecklistItem_initiative_idx";

-- DropIndex
DROP INDEX "ChecklistTick_item_idx";

-- DropIndex
DROP INDEX "ChecklistTick_period_idx";

-- DropIndex
DROP INDEX "Initiative_userGoal_idx";

-- DropIndex
DROP INDEX "Objective_alignsToKr_idx";

-- DropIndex
DROP INDEX "UserGoal_user_idx";

-- AlterTable
ALTER TABLE "UserGoal" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "plateNo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Car_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarDispatchRequest" (
    "id" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "coRiders" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarDispatchRequest_pkey" PRIMARY KEY ("id")
);

-- RenameForeignKey
ALTER TABLE "ChecklistItem" RENAME CONSTRAINT "ChecklistItem_initiative_fkey" TO "ChecklistItem_initiativeId_fkey";

-- RenameForeignKey
ALTER TABLE "ChecklistTick" RENAME CONSTRAINT "ChecklistTick_actor_fkey" TO "ChecklistTick_actorId_fkey";

-- RenameForeignKey
ALTER TABLE "Initiative" RENAME CONSTRAINT "Initiative_userGoal_fkey" TO "Initiative_userGoalId_fkey";

-- RenameForeignKey
ALTER TABLE "Objective" RENAME CONSTRAINT "Objective_alignsToKr_fkey" TO "Objective_alignsToKrId_fkey";

-- AddForeignKey
ALTER TABLE "UserGoal" ADD CONSTRAINT "UserGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResultAssignment" ADD CONSTRAINT "KeyResultAssignment_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResultAssignment" ADD CONSTRAINT "KeyResultAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTick" ADD CONSTRAINT "ChecklistTick_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarDispatchRequest" ADD CONSTRAINT "CarDispatchRequest_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarDispatchRequest" ADD CONSTRAINT "CarDispatchRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarDispatchRequest" ADD CONSTRAINT "CarDispatchRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
