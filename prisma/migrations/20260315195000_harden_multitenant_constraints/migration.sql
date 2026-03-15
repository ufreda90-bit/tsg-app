-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_technicianId_fkey";
ALTER TABLE "Intervention" DROP CONSTRAINT "Intervention_technicianId_fkey";
ALTER TABLE "Intervention" DROP CONSTRAINT "Intervention_secondaryTechnicianId_fkey";
ALTER TABLE "Intervention" DROP CONSTRAINT "Intervention_customerId_fkey";
ALTER TABLE "Intervention" DROP CONSTRAINT "Intervention_jobId_fkey";
ALTER TABLE "Site" DROP CONSTRAINT "Site_customerId_fkey";
ALTER TABLE "Job" DROP CONSTRAINT "Job_siteId_fkey";
ALTER TABLE "WorkReport" DROP CONSTRAINT "WorkReport_interventionId_fkey";
ALTER TABLE "Media" DROP CONSTRAINT "Media_interventionId_fkey";
ALTER TABLE "InterventionAttachment" DROP CONSTRAINT "InterventionAttachment_interventionId_fkey";
ALTER TABLE "WorkReportAttachment" DROP CONSTRAINT "WorkReportAttachment_workReportId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "User_username_key";
DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "PushSubscription_endpoint_key";
DROP INDEX IF EXISTS "WorkReport_reportNumber_key";
DROP INDEX IF EXISTS "WorkReport_interventionId_key";
DROP INDEX IF EXISTS "Technician_email_key";
DROP INDEX IF EXISTS "Customer_taxCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "Technician_organizationId_id_key" ON "Technician"("organizationId", "id");
CREATE UNIQUE INDEX "Technician_organizationId_email_key" ON "Technician"("organizationId", "email");
CREATE UNIQUE INDEX "User_organizationId_username_key" ON "User"("organizationId", "username");
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");
CREATE UNIQUE INDEX "User_organizationId_technicianId_key" ON "User"("organizationId", "technicianId");
CREATE UNIQUE INDEX "Intervention_organizationId_id_key" ON "Intervention"("organizationId", "id");
CREATE UNIQUE INDEX "Customer_organizationId_id_key" ON "Customer"("organizationId", "id");
CREATE UNIQUE INDEX "Customer_organizationId_taxCode_key" ON "Customer"("organizationId", "taxCode");
CREATE UNIQUE INDEX "Site_organizationId_id_key" ON "Site"("organizationId", "id");
CREATE UNIQUE INDEX "Job_organizationId_id_key" ON "Job"("organizationId", "id");
CREATE UNIQUE INDEX "WorkReport_organizationId_id_key" ON "WorkReport"("organizationId", "id");
CREATE UNIQUE INDEX "WorkReport_organizationId_reportNumber_key" ON "WorkReport"("organizationId", "reportNumber");
CREATE UNIQUE INDEX "WorkReport_organizationId_interventionId_key" ON "WorkReport"("organizationId", "interventionId");
CREATE UNIQUE INDEX "PushSubscription_organizationId_endpoint_key" ON "PushSubscription"("organizationId", "endpoint");

CREATE INDEX "Media_organizationId_interventionId_idx" ON "Media"("organizationId", "interventionId");
CREATE INDEX "PushSubscription_organizationId_technicianId_idx" ON "PushSubscription"("organizationId", "technicianId");
CREATE INDEX "InterventionAttachment_organizationId_interventionId_idx" ON "InterventionAttachment"("organizationId", "interventionId");
CREATE INDEX "WorkReportAttachment_organizationId_workReportId_idx" ON "WorkReportAttachment"("organizationId", "workReportId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_technicianId_fkey" FOREIGN KEY ("organizationId", "technicianId") REFERENCES "Technician"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_technicianId_fkey" FOREIGN KEY ("organizationId", "technicianId") REFERENCES "Technician"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_secondaryTechnicianId_fkey" FOREIGN KEY ("organizationId", "secondaryTechnicianId") REFERENCES "Technician"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_jobId_fkey" FOREIGN KEY ("organizationId", "jobId") REFERENCES "Job"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_siteId_fkey" FOREIGN KEY ("organizationId", "siteId") REFERENCES "Site"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "Intervention"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Media" ADD CONSTRAINT "Media_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "Intervention"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_organizationId_technicianId_fkey" FOREIGN KEY ("organizationId", "technicianId") REFERENCES "Technician"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterventionAttachment" ADD CONSTRAINT "InterventionAttachment_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "Intervention"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkReportAttachment" ADD CONSTRAINT "WorkReportAttachment_organizationId_workReportId_fkey" FOREIGN KEY ("organizationId", "workReportId") REFERENCES "WorkReport"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
