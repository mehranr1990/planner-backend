ALTER TABLE "ContextInvitation" ADD COLUMN "emailDeliveryState" VARCHAR(11) NOT NULL DEFAULT 'NONE';
ALTER TABLE "ContextInvitation" ADD CONSTRAINT "ContextInvitation_email_delivery_check"
  CHECK ("emailDeliveryState" IN ('NONE', 'SENT', 'FAILED', 'UNAVAILABLE'));
