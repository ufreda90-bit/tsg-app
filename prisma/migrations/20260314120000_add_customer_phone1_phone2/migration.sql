DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'Customer'
      AND column_name = 'phone'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'Customer'
      AND column_name = 'phone1'
  ) THEN
    ALTER TABLE "Customer" RENAME COLUMN "phone" TO "phone1";
  END IF;
END $$;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "phone2" TEXT;
