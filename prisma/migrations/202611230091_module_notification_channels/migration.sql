-- Missing modules inherit the existing global channel policy.
ALTER TABLE "NotificationPreference" ADD COLUMN "moduleChannels" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_module_channels_object" CHECK (jsonb_typeof("moduleChannels") = 'object');
