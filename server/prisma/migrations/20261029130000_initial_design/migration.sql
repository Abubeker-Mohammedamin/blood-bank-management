-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "phone_e164" VARCHAR(16),
    "account_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(160) NOT NULL,
    "registration_number" VARCHAR(80),
    "phone" VARCHAR(32),
    "email" VARCHAR(254),
    "address_line_1" VARCHAR(160),
    "address_line_2" VARCHAR(160),
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country_code" CHAR(2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "employee_number" VARCHAR(40) NOT NULL,
    "job_title" VARCHAR(100),
    "staff_status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "started_at" DATE,
    "ended_at" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "donor_number" VARCHAR(40) NOT NULL,
    "date_of_birth" DATE,
    "donor_status" VARCHAR(20) NOT NULL DEFAULT 'registered',
    "eligibility_reviewed_at" TIMESTAMPTZ(3),
    "consent_given_at" TIMESTAMPTZ(3),
    "consent_version" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deactivated_at" TIMESTAMPTZ(3),

    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(6) NOT NULL,
    "abo_group" VARCHAR(2) NOT NULL,
    "rh_factor" CHAR(1) NOT NULL,

    CONSTRAINT "blood_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donor_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "scheduled_start_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(3) NOT NULL,
    "appointment_status" VARCHAR(20) NOT NULL DEFAULT 'booked',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_number" VARCHAR(40) NOT NULL,
    "donor_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "collected_by_staff_id" UUID,
    "appointment_id" UUID,
    "donation_status" VARCHAR(20) NOT NULL DEFAULT 'collected',
    "collection_started_at" TIMESTAMPTZ(3),
    "collected_at" TIMESTAMPTZ(3),
    "volume_ml" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laboratory_tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "test_type" VARCHAR(40) NOT NULL,
    "attempt_no" SMALLINT NOT NULL DEFAULT 1,
    "performed_by_staff_id" UUID,
    "test_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "result_code" VARCHAR(40),
    "result_blood_type_id" UUID,
    "sample_collected_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laboratory_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_blood_types" (
    "donation_id" UUID NOT NULL,
    "blood_type_id" UUID NOT NULL,
    "verified_by_test_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "donation_blood_types_pkey" PRIMARY KEY ("donation_id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospital_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "location_type" VARCHAR(30) NOT NULL,
    "min_temperature_c" DECIMAL(4,1),
    "max_temperature_c" DECIMAL(4,1),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "unit_code" VARCHAR(60) NOT NULL,
    "component_type" VARCHAR(30) NOT NULL,
    "unit_status" VARCHAR(20) NOT NULL DEFAULT 'quarantined',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "current_storage_location_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blood_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_number" VARCHAR(40) NOT NULL,
    "hospital_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "blood_type_id" UUID NOT NULL,
    "component_type" VARCHAR(30) NOT NULL,
    "quantity_requested" SMALLINT NOT NULL,
    "priority" VARCHAR(16) NOT NULL DEFAULT 'routine',
    "request_status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needed_by" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "blood_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blood_request_id" UUID NOT NULL,
    "blood_unit_id" UUID NOT NULL,
    "allocated_by_user_id" UUID NOT NULL,
    "allocation_status" VARCHAR(20) NOT NULL DEFAULT 'reserved',
    "allocated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilled_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_unit_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blood_unit_id" UUID NOT NULL,
    "from_storage_location_id" UUID,
    "to_storage_location_id" UUID,
    "moved_by_staff_id" UUID,
    "moved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_code" VARCHAR(30),

    CONSTRAINT "blood_unit_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "notification_type" VARCHAR(40) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "delivery_status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" UUID,
    "changed_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_registration_number_key" ON "hospitals"("registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_id_key" ON "staff"("user_id");

-- CreateIndex
CREATE INDEX "staff_hospital_id_idx" ON "staff"("hospital_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_hospital_id_employee_number_key" ON "staff"("hospital_id", "employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "donors_user_id_key" ON "donors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "donors_donor_number_key" ON "donors"("donor_number");

-- CreateIndex
CREATE UNIQUE INDEX "blood_types_code_key" ON "blood_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "blood_types_abo_group_rh_factor_key" ON "blood_types"("abo_group", "rh_factor");

-- CreateIndex
CREATE INDEX "appointments_donor_id_scheduled_start_at_idx" ON "appointments"("donor_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "appointments_hospital_id_scheduled_start_at_idx" ON "appointments"("hospital_id", "scheduled_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "donations_donation_number_key" ON "donations"("donation_number");

-- CreateIndex
CREATE UNIQUE INDEX "donations_appointment_id_key" ON "donations"("appointment_id");

-- CreateIndex
CREATE INDEX "donations_donor_id_collected_at_idx" ON "donations"("donor_id", "collected_at" DESC);

-- CreateIndex
CREATE INDEX "donations_hospital_id_collected_at_idx" ON "donations"("hospital_id", "collected_at" DESC);

-- CreateIndex
CREATE INDEX "laboratory_tests_donation_id_test_type_recorded_at_idx" ON "laboratory_tests"("donation_id", "test_type", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "laboratory_tests_donation_id_test_type_attempt_no_key" ON "laboratory_tests"("donation_id", "test_type", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "laboratory_tests_id_donation_id_result_blood_type_id_key" ON "laboratory_tests"("id", "donation_id", "result_blood_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "donation_blood_types_verified_by_test_id_key" ON "donation_blood_types"("verified_by_test_id");

-- CreateIndex
CREATE UNIQUE INDEX "donation_blood_types_verified_by_test_id_donation_id_blood__key" ON "donation_blood_types"("verified_by_test_id", "donation_id", "blood_type_id");

-- CreateIndex
CREATE INDEX "storage_locations_hospital_id_idx" ON "storage_locations"("hospital_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_hospital_id_code_key" ON "storage_locations"("hospital_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "blood_units_unit_code_key" ON "blood_units"("unit_code");

-- CreateIndex
CREATE INDEX "blood_units_unit_status_expires_at_idx" ON "blood_units"("unit_status", "expires_at");

-- CreateIndex
CREATE INDEX "blood_units_donation_id_idx" ON "blood_units"("donation_id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_requests_request_number_key" ON "blood_requests"("request_number");

-- CreateIndex
CREATE INDEX "blood_requests_hospital_id_request_status_needed_by_idx" ON "blood_requests"("hospital_id", "request_status", "needed_by");

-- CreateIndex
CREATE INDEX "blood_requests_blood_type_id_component_type_request_status_idx" ON "blood_requests"("blood_type_id", "component_type", "request_status");

-- CreateIndex
CREATE INDEX "allocations_blood_request_id_allocation_status_idx" ON "allocations"("blood_request_id", "allocation_status");

-- CreateIndex
CREATE INDEX "blood_unit_movements_blood_unit_id_moved_at_idx" ON "blood_unit_movements"("blood_unit_id", "moved_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_delivery_status_created_at_idx" ON "notifications"("user_id", "delivery_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs"("actor_user_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donors" ADD CONSTRAINT "donors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_collected_by_staff_id_fkey" FOREIGN KEY ("collected_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laboratory_tests" ADD CONSTRAINT "laboratory_tests_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laboratory_tests" ADD CONSTRAINT "laboratory_tests_performed_by_staff_id_fkey" FOREIGN KEY ("performed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laboratory_tests" ADD CONSTRAINT "laboratory_tests_result_blood_type_id_fkey" FOREIGN KEY ("result_blood_type_id") REFERENCES "blood_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_blood_types" ADD CONSTRAINT "donation_blood_types_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_blood_types" ADD CONSTRAINT "donation_blood_types_blood_type_id_fkey" FOREIGN KEY ("blood_type_id") REFERENCES "blood_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation_blood_types" ADD CONSTRAINT "donation_blood_types_verified_by_test_id_donation_id_blood_fkey" FOREIGN KEY ("verified_by_test_id", "donation_id", "blood_type_id") REFERENCES "laboratory_tests"("id", "donation_id", "result_blood_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_units" ADD CONSTRAINT "blood_units_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_units" ADD CONSTRAINT "blood_units_current_storage_location_id_fkey" FOREIGN KEY ("current_storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_blood_type_id_fkey" FOREIGN KEY ("blood_type_id") REFERENCES "blood_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_blood_request_id_fkey" FOREIGN KEY ("blood_request_id") REFERENCES "blood_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_blood_unit_id_fkey" FOREIGN KEY ("blood_unit_id") REFERENCES "blood_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_allocated_by_user_id_fkey" FOREIGN KEY ("allocated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_movements" ADD CONSTRAINT "blood_unit_movements_blood_unit_id_fkey" FOREIGN KEY ("blood_unit_id") REFERENCES "blood_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_movements" ADD CONSTRAINT "blood_unit_movements_from_storage_location_id_fkey" FOREIGN KEY ("from_storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_movements" ADD CONSTRAINT "blood_unit_movements_to_storage_location_id_fkey" FOREIGN KEY ("to_storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_movements" ADD CONSTRAINT "blood_unit_movements_moved_by_staff_id_fkey" FOREIGN KEY ("moved_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma does not represent these CHECK constraints and partial indexes in schema.prisma.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email")),
    ADD CONSTRAINT "users_account_status_check" CHECK ("account_status" IN ('pending', 'active', 'disabled'));
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));

ALTER TABLE "user_roles"
    ADD CONSTRAINT "user_roles_revocation_pair_check"
    CHECK (("revoked_at" IS NULL) = ("revoked_by_user_id" IS NULL));
CREATE UNIQUE INDEX "user_roles_active_unique"
    ON "user_roles" ("user_id", "role_id")
    WHERE "revoked_at" IS NULL;

ALTER TABLE "staff"
    ADD CONSTRAINT "staff_status_check" CHECK ("staff_status" IN ('active', 'inactive')),
    ADD CONSTRAINT "staff_date_range_check"
    CHECK ("started_at" IS NULL OR "ended_at" IS NULL OR "ended_at" >= "started_at");

ALTER TABLE "donors"
    ADD CONSTRAINT "donors_status_check"
    CHECK ("donor_status" IN ('registered', 'active', 'deferred', 'inactive'));

ALTER TABLE "blood_types"
    ADD CONSTRAINT "blood_types_abo_group_check" CHECK ("abo_group" IN ('A', 'B', 'AB', 'O')),
    ADD CONSTRAINT "blood_types_rh_factor_check" CHECK ("rh_factor" IN ('+', '-'));

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_status_check"
    CHECK ("appointment_status" IN ('booked', 'cancelled', 'completed', 'missed')),
    ADD CONSTRAINT "appointments_time_range_check" CHECK ("scheduled_end_at" > "scheduled_start_at");

ALTER TABLE "donations"
    ADD CONSTRAINT "donations_status_check"
    CHECK ("donation_status" IN ('collected', 'testing', 'released', 'discarded')),
    ADD CONSTRAINT "donations_volume_positive_check" CHECK ("volume_ml" IS NULL OR "volume_ml" > 0),
    ADD CONSTRAINT "donations_collection_time_check"
    CHECK ("collection_started_at" IS NULL OR "collected_at" IS NULL OR "collected_at" >= "collection_started_at");

ALTER TABLE "laboratory_tests"
    ADD CONSTRAINT "laboratory_tests_attempt_positive_check" CHECK ("attempt_no" > 0),
    ADD CONSTRAINT "laboratory_tests_status_check" CHECK ("test_status" IN ('pending', 'completed', 'invalid')),
    ADD CONSTRAINT "laboratory_tests_result_blood_type_check"
    CHECK (
        ("result_blood_type_id" IS NULL OR ("test_type" = 'ABO_RH' AND "test_status" = 'completed'))
        AND (NOT ("test_type" = 'ABO_RH' AND "test_status" = 'completed') OR "result_blood_type_id" IS NOT NULL)
    );

ALTER TABLE "storage_locations"
    ADD CONSTRAINT "storage_locations_temperature_range_check"
    CHECK (
        "min_temperature_c" IS NULL
        OR "max_temperature_c" IS NULL
        OR "max_temperature_c" > "min_temperature_c"
    );

ALTER TABLE "blood_units"
    ADD CONSTRAINT "blood_units_component_type_check"
    CHECK ("component_type" IN ('whole_blood', 'red_cells', 'plasma', 'platelets')),
    ADD CONSTRAINT "blood_units_status_check"
    CHECK ("unit_status" IN ('quarantined', 'available', 'reserved', 'issued', 'expired', 'discarded')),
    ADD CONSTRAINT "blood_units_expiration_check" CHECK ("expires_at" > "collected_at");

ALTER TABLE "blood_requests"
    ADD CONSTRAINT "blood_requests_component_type_check"
    CHECK ("component_type" IN ('whole_blood', 'red_cells', 'plasma', 'platelets')),
    ADD CONSTRAINT "blood_requests_quantity_positive_check" CHECK ("quantity_requested" > 0),
    ADD CONSTRAINT "blood_requests_priority_check" CHECK ("priority" IN ('routine', 'urgent', 'emergency')),
    ADD CONSTRAINT "blood_requests_status_check"
    CHECK ("request_status" IN ('open', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired')),
    ADD CONSTRAINT "blood_requests_needed_by_check"
    CHECK ("needed_by" IS NULL OR "needed_by" >= "requested_at");

ALTER TABLE "allocations"
    ADD CONSTRAINT "allocations_status_check"
    CHECK ("allocation_status" IN ('reserved', 'fulfilled', 'cancelled')),
    ADD CONSTRAINT "allocations_completion_time_check"
    CHECK (
        ("allocation_status" <> 'fulfilled' OR "fulfilled_at" IS NOT NULL)
        AND ("allocation_status" <> 'cancelled' OR "cancelled_at" IS NOT NULL)
    );
CREATE UNIQUE INDEX "allocations_active_unit_unique"
    ON "allocations" ("blood_unit_id")
    WHERE "allocation_status" IN ('reserved', 'fulfilled');

ALTER TABLE "blood_unit_movements"
    ADD CONSTRAINT "blood_unit_movements_location_check"
    CHECK (
        "from_storage_location_id" IS NOT NULL
        OR "to_storage_location_id" IS NOT NULL
    ),
    ADD CONSTRAINT "blood_unit_movements_different_locations_check"
    CHECK (
        "from_storage_location_id" IS NULL
        OR "to_storage_location_id" IS NULL
        OR "from_storage_location_id" <> "to_storage_location_id"
    );

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_channel_check" CHECK ("channel" IN ('email', 'sms', 'in_app')),
    ADD CONSTRAINT "notifications_status_check"
    CHECK ("delivery_status" IN ('queued', 'sent', 'failed', 'read'));

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object');
