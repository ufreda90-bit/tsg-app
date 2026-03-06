-- Demo customer fields: type + preferred time slot, plus unique taxCode for idempotent CSV import
CREATE TYPE "CustomerType" AS ENUM ('PRIVATO', 'AZIENDA');
CREATE TYPE "PreferredTimeSlot" AS ENUM ('MATTINA', 'PRANZO', 'POMERIGGIO', 'SERA', 'INDIFFERENTE');

ALTER TABLE "Customer"
  ADD COLUMN "customerType" "CustomerType" NOT NULL DEFAULT 'PRIVATO',
  ADD COLUMN "preferredTimeSlot" "PreferredTimeSlot" NOT NULL DEFAULT 'INDIFFERENTE';

CREATE UNIQUE INDEX "Customer_taxCode_key" ON "Customer"("taxCode");
