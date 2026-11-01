ALTER TABLE "donors"
    ADD COLUMN "registration_hospital_id" UUID;

CREATE INDEX "donors_registration_hospital_id_idx"
    ON "donors"("registration_hospital_id");

ALTER TABLE "donors"
    ADD CONSTRAINT "donors_registration_hospital_id_fkey"
    FOREIGN KEY ("registration_hospital_id") REFERENCES "hospitals"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
