-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('Admin', 'Sales', 'Manager', 'Finance', 'Operations');

-- CreateTable
CREATE TABLE "staff_user" (
    "version" INTEGER NOT NULL DEFAULT 1,
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activated_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_role" (
    "user_id" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,

    CONSTRAINT "staff_role_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "staff_session" (
    "digest" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "password_reset" (
    "user_id" UUID NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "access_event" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_email_key" ON "staff_user"("email");

-- CreateIndex
CREATE INDEX "staff_session_user_id_idx" ON "staff_session"("user_id");

-- CreateIndex
CREATE INDEX "staff_session_expires_at_idx" ON "staff_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_digest_key" ON "password_reset"("digest");

-- CreateIndex
CREATE INDEX "access_event_subject_id_created_at_idx" ON "access_event"("subject_id", "created_at");

-- AddForeignKey
ALTER TABLE "staff_role" ADD CONSTRAINT "staff_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_event" ADD CONSTRAINT "access_event_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
