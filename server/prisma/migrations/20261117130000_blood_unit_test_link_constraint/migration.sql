DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'blood_units_id_donation_id_key'
          AND conrelid = 'public.blood_units'::regclass
    ) THEN
        ALTER TABLE "blood_units"
            ADD CONSTRAINT "blood_units_id_donation_id_key" UNIQUE ("id", "donation_id");
    END IF;
END;
$$;
