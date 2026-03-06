/*
  Warnings:

  - The `status` column on the `Intervention` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "Intervention" DROP COLUMN "status",
ADD COLUMN     "status" "InterventionStatus" NOT NULL DEFAULT 'SCHEDULED';
