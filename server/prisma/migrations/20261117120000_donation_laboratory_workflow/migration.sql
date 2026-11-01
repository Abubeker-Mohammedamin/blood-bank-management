ALTER TABLE "laboratory_tests"
    ADD COLUMN "blood_unit_id" UUID,
    ADD COLUMN "reviewed_by_staff_id" UUID,
    ADD COLUMN "review_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN "performed_at" TIMESTAMPTZ(3),
    ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
    ADD CONSTRAINT "laboratory_tests_blood_unit_donation_fkey"
        FOREIGN KEY ("blood_unit_id", "donation_id")
        REFERENCES "blood_units"("id", "donation_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "laboratory_tests_reviewed_by_staff_id_fkey"
        FOREIGN KEY ("reviewed_by_staff_id")
        REFERENCES "staff"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "laboratory_tests_review_status_check"
        CHECK ("review_status" IN ('pending', 'approved', 'rejected')),
    ADD CONSTRAINT "laboratory_tests_review_approval_check"
        CHECK (
            ("review_status" = 'pending' AND "reviewed_by_staff_id" IS NULL AND "reviewed_at" IS NULL)
            OR (
                "review_status" IN ('approved', 'rejected')
                AND "reviewed_by_staff_id" IS NOT NULL
                AND "reviewed_at" IS NOT NULL
            )
        );

ALTER TABLE "laboratory_tests"
    DROP CONSTRAINT "laboratory_tests_status_check",
    ADD CONSTRAINT "laboratory_tests_status_check"
        CHECK ("test_status" IN ('pending', 'completed', 'failed', 'invalid')),
    ADD CONSTRAINT "laboratory_tests_approved_result_check"
        CHECK (
            "review_status" <> 'approved'
            OR ("test_status" = 'completed' AND "result_code" IS NOT NULL)
        );

CREATE INDEX "laboratory_tests_blood_unit_id_test_type_attempt_no_idx"
    ON "laboratory_tests"("blood_unit_id", "test_type", "attempt_no");
