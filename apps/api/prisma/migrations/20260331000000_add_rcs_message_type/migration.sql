-- Add message_type column for SMS/RCS discrimination
ALTER TABLE "sms_messages" ADD COLUMN "message_type" TEXT NOT NULL DEFAULT 'sms';

-- Add sender_display_name for RCS sender names from notifications
ALTER TABLE "sms_messages" ADD COLUMN "sender_display_name" TEXT;

-- Index for filtering by message type
CREATE INDEX "sms_messages_message_type_idx" ON "sms_messages"("message_type");
