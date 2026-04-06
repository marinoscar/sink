-- AlterTable
ALTER TABLE "sms_messages" ADD COLUMN "is_otp" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "idx_sms_messages_user_id_is_otp" ON "sms_messages"("user_id", "is_otp");
