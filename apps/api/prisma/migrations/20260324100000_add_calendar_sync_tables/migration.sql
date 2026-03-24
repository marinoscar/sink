-- CreateTable
CREATE TABLE "calendar_sync_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "sync_frequency_minutes" INTEGER NOT NULL DEFAULT 60,
    "encrypted_refresh_token" TEXT,
    "google_email" TEXT,
    "last_sync_at" TIMESTAMPTZ,
    "last_sync_status" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "calendar_sync_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL,
    "entries_processed" INTEGER NOT NULL DEFAULT 0,
    "entries_created" INTEGER NOT NULL DEFAULT 0,
    "entries_updated" INTEGER NOT NULL DEFAULT 0,
    "entries_deleted" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "error_details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sync_configs_user_id_key" ON "calendar_sync_configs"("user_id");

-- CreateIndex
CREATE INDEX "calendar_sync_logs_user_id_created_at_idx" ON "calendar_sync_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_sync_logs_config_id_idx" ON "calendar_sync_logs"("config_id");

-- AddForeignKey
ALTER TABLE "calendar_sync_configs" ADD CONSTRAINT "calendar_sync_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_sync_logs" ADD CONSTRAINT "calendar_sync_logs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "calendar_sync_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
