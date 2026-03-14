-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Backfill existing users with deterministic usernames
UPDATE "User"
SET "username" = CONCAT('user', "id")
WHERE "username" IS NULL;

-- Enforce required username after backfill
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
