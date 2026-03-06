DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttachmentKind') THEN
    CREATE TYPE "AttachmentKind" AS ENUM ('AUDIO', 'IMAGE', 'FILE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "InterventionAttachment" (
  "id" TEXT NOT NULL,
  "interventionId" INTEGER NOT NULL,
  "kind" "AttachmentKind" NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterventionAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkReportAttachment" (
  "id" TEXT NOT NULL,
  "workReportId" TEXT NOT NULL,
  "kind" "AttachmentKind" NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkReportAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InterventionAttachment_interventionId_fkey'
  ) THEN
    ALTER TABLE "InterventionAttachment"
      ADD CONSTRAINT "InterventionAttachment_interventionId_fkey"
      FOREIGN KEY ("interventionId") REFERENCES "Intervention"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkReportAttachment_workReportId_fkey'
  ) THEN
    ALTER TABLE "WorkReportAttachment"
      ADD CONSTRAINT "WorkReportAttachment_workReportId_fkey"
      FOREIGN KEY ("workReportId") REFERENCES "WorkReport"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "InterventionAttachment_interventionId_idx" ON "InterventionAttachment"("interventionId");
CREATE INDEX IF NOT EXISTS "WorkReportAttachment_workReportId_idx" ON "WorkReportAttachment"("workReportId");
