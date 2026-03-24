-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('pending', 'synced', 'deleted');

-- AlterTable
ALTER TABLE "allowed_emails" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "audit_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "device_codes" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "permissions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "storage_object_chunks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "storage_objects" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "system_settings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_identities" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_uploads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "export_date" TEXT NOT NULL,
    "range_start" TEXT NOT NULL,
    "range_end" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "entries_processed" INTEGER NOT NULL DEFAULT 0,
    "entries_created" INTEGER NOT NULL DEFAULT 0,
    "entries_updated" INTEGER NOT NULL DEFAULT 0,
    "entries_deleted" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entry_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "data_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "CalendarSyncStatus" NOT NULL DEFAULT 'pending',
    "google_event_id" TEXT,
    "last_synced_at" TIMESTAMPTZ,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_token_id_key" ON "personal_access_tokens"("token_id");

-- CreateIndex
CREATE INDEX "personal_access_tokens_user_id_idx" ON "personal_access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "calendar_uploads_user_id_idx" ON "calendar_uploads"("user_id");

-- CreateIndex
CREATE INDEX "calendar_uploads_created_at_idx" ON "calendar_uploads"("created_at");

-- CreateIndex
CREATE INDEX "calendar_entries_user_id_sync_status_idx" ON "calendar_entries"("user_id", "sync_status");

-- CreateIndex
CREATE INDEX "calendar_entries_user_id_is_deleted_idx" ON "calendar_entries"("user_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_entries_user_id_entry_id_key" ON "calendar_entries"("user_id", "entry_id");

-- AddForeignKey
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_uploads" ADD CONSTRAINT "calendar_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
