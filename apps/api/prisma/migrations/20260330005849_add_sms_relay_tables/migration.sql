-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_code_id" UUID,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "push_token" TEXT,
    "last_seen_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sims" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "carrier_name" TEXT,
    "phone_number" TEXT,
    "icc_id" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_sims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "device_sim_id" UUID,
    "sender" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sms_timestamp" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_hash" TEXT NOT NULL,
    "sim_slot_index" INTEGER,
    "carrier_name" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "storage_object_id" UUID,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT,
    "size" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_code_id_key" ON "devices"("device_code_id");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_name_key" ON "devices"("user_id", "name");

-- CreateIndex
CREATE INDEX "device_sims_device_id_idx" ON "device_sims"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_sims_device_id_subscription_id_key" ON "device_sims"("device_id", "subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_message_hash_key" ON "sms_messages"("message_hash");

-- CreateIndex
CREATE INDEX "sms_messages_user_id_sms_timestamp_idx" ON "sms_messages"("user_id", "sms_timestamp");

-- CreateIndex
CREATE INDEX "sms_messages_user_id_sender_idx" ON "sms_messages"("user_id", "sender");

-- CreateIndex
CREATE INDEX "sms_messages_device_id_idx" ON "sms_messages"("device_id");

-- CreateIndex
CREATE INDEX "sms_messages_received_at_idx" ON "sms_messages"("received_at");

-- CreateIndex
CREATE INDEX "sms_attachments_message_id_idx" ON "sms_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_device_code_id_fkey" FOREIGN KEY ("device_code_id") REFERENCES "device_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sims" ADD CONSTRAINT "device_sims_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_device_sim_id_fkey" FOREIGN KEY ("device_sim_id") REFERENCES "device_sims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_attachments" ADD CONSTRAINT "sms_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "sms_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_attachments" ADD CONSTRAINT "sms_attachments_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
