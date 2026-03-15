-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Intervention" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InterventionAttachment" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Media" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PushSubscription" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Site" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Technician" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WorkReport" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WorkReportAttachment" ALTER COLUMN "organizationId" DROP DEFAULT;
