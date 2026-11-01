ALTER TABLE "blood_requests"
    ADD COLUMN "request_details" VARCHAR(1000),
    ADD COLUMN "reviewed_by_user_id" UUID,
    ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
    ADD COLUMN "review_note" VARCHAR(1000);

ALTER TABLE "blood_requests"
    DROP CONSTRAINT "blood_requests_status_check",
    ADD CONSTRAINT "blood_requests_status_check"
        CHECK ("request_status" IN ('open', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired'));

ALTER TABLE "blood_requests"
    ADD CONSTRAINT "blood_requests_review_pair_check"
        CHECK (("reviewed_by_user_id" IS NULL) = ("reviewed_at" IS NULL)),
    ADD CONSTRAINT "blood_requests_reviewed_by_user_id_fkey"
        FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "blood_request_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blood_request_id" UUID NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "previous_status" VARCHAR(24),
    "new_status" VARCHAR(24) NOT NULL,
    "note" VARCHAR(1000),
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blood_request_status_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blood_request_status_history_status_check"
        CHECK ("new_status" IN ('open', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired')),
    CONSTRAINT "blood_request_status_history_blood_request_id_fkey"
        FOREIGN KEY ("blood_request_id") REFERENCES "blood_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "blood_request_status_history_changed_by_user_id_fkey"
        FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "blood_request_status_history_blood_request_id_changed_at_idx"
    ON "blood_request_status_history" ("blood_request_id", "changed_at");

CREATE TABLE "blood_compatibility_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "policy_version" VARCHAR(80) NOT NULL,
    "policy_description" VARCHAR(1000) NOT NULL,
    "reviewer_name" VARCHAR(160) NOT NULL,
    "reviewer_credential" VARCHAR(160) NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blood_compatibility_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blood_compatibility_approvals_content_check"
        CHECK (
            length(trim("policy_version")) > 0
            AND length(trim("policy_description")) > 0
            AND length(trim("reviewer_name")) > 0
            AND length(trim("reviewer_credential")) > 0
        ),
    CONSTRAINT "blood_compatibility_approvals_recorded_by_user_id_fkey"
        FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "blood_compatibility_approvals_is_active_reviewed_at_idx"
    ON "blood_compatibility_approvals" ("is_active", "reviewed_at");
CREATE UNIQUE INDEX "blood_compatibility_approvals_one_active_idx"
    ON "blood_compatibility_approvals" ("is_active") WHERE "is_active";

CREATE UNIQUE INDEX "allocations_id_blood_request_id_blood_unit_id_key"
    ON "allocations" ("id", "blood_request_id", "blood_unit_id");

CREATE TABLE "blood_dispatches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "allocation_id" UUID NOT NULL,
    "blood_request_id" UUID NOT NULL,
    "blood_unit_id" UUID NOT NULL,
    "dispatched_by_user_id" UUID NOT NULL,
    "dispatched_by_staff_id" UUID NOT NULL,
    "delivery_status" VARCHAR(20) NOT NULL DEFAULT 'dispatched',
    "dispatched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "final_disposition" VARCHAR(40),
    CONSTRAINT "blood_dispatches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blood_dispatches_allocation_id_key" UNIQUE ("allocation_id"),
    CONSTRAINT "blood_dispatches_allocation_id_blood_request_id_blood_unit_id_key"
        UNIQUE ("allocation_id", "blood_request_id", "blood_unit_id"),
    CONSTRAINT "blood_dispatches_status_check"
        CHECK ("delivery_status" IN ('dispatched', 'delivered', 'returned', 'discarded')),
    CONSTRAINT "blood_dispatches_disposition_check"
        CHECK (
            ("delivery_status" = 'dispatched' AND "delivered_at" IS NULL AND "final_disposition" IS NULL)
            OR ("delivery_status" = 'delivered' AND "delivered_at" IS NOT NULL AND "final_disposition" IN ('transfused', 'not_transfused'))
            OR ("delivery_status" = 'returned' AND "delivered_at" IS NOT NULL AND "final_disposition" = 'returned_to_inventory_quarantine')
            OR ("delivery_status" = 'discarded' AND "delivered_at" IS NOT NULL AND "final_disposition" = 'discarded')
        ),
    CONSTRAINT "blood_dispatches_allocation_id_blood_request_id_blood_unit_id_fkey"
        FOREIGN KEY ("allocation_id", "blood_request_id", "blood_unit_id")
        REFERENCES "allocations"("id", "blood_request_id", "blood_unit_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "blood_dispatches_blood_request_id_fkey"
        FOREIGN KEY ("blood_request_id") REFERENCES "blood_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "blood_dispatches_blood_unit_id_fkey"
        FOREIGN KEY ("blood_unit_id") REFERENCES "blood_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "blood_dispatches_dispatched_by_user_id_fkey"
        FOREIGN KEY ("dispatched_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "blood_dispatches_dispatched_by_staff_id_fkey"
        FOREIGN KEY ("dispatched_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "blood_dispatches_blood_request_id_dispatched_at_idx"
    ON "blood_dispatches" ("blood_request_id", "dispatched_at");
CREATE INDEX "blood_dispatches_blood_unit_id_dispatched_at_idx"
    ON "blood_dispatches" ("blood_unit_id", "dispatched_at");

CREATE TABLE "blood_dispatch_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blood_dispatch_id" UUID NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "previous_status" VARCHAR(20),
    "new_status" VARCHAR(20) NOT NULL,
    "final_disposition" VARCHAR(40),
    "note" VARCHAR(1000),
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blood_dispatch_status_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blood_dispatch_status_history_status_check"
        CHECK ("new_status" IN ('dispatched', 'delivered', 'returned', 'discarded')),
    CONSTRAINT "blood_dispatch_status_history_blood_dispatch_id_fkey"
        FOREIGN KEY ("blood_dispatch_id") REFERENCES "blood_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "blood_dispatch_status_history_changed_by_user_id_fkey"
        FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "blood_dispatch_status_history_blood_dispatch_id_changed_at_idx"
    ON "blood_dispatch_status_history" ("blood_dispatch_id", "changed_at");
