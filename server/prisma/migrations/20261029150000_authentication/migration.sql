ALTER TABLE "users"
    ADD COLUMN "password_hash" TEXT;

CREATE TABLE "user_sessions" (
    "sid" VARCHAR(255) NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX "user_sessions_expire_idx" ON "user_sessions"("expire");
