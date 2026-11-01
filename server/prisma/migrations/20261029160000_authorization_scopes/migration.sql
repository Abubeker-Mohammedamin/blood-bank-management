CREATE TABLE "hospital_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hospital_users_user_id_hospital_id_key"
    ON "hospital_users"("user_id", "hospital_id");

CREATE INDEX "hospital_users_hospital_id_is_active_idx"
    ON "hospital_users"("hospital_id", "is_active");

ALTER TABLE "hospital_users"
    ADD CONSTRAINT "hospital_users_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hospital_users"
    ADD CONSTRAINT "hospital_users_hospital_id_fkey"
    FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
