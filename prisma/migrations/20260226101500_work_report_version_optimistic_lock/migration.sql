-- Add optimistic locking version to WorkReport with default for existing rows
ALTER TABLE "WorkReport"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

