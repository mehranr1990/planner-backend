-- Client integration additions. Existing canonical units, settings and schedules stay unchanged.
ALTER TABLE "ConversationInvitation" ADD COLUMN "notificationReadAt" timestamptz(3);
ALTER TABLE "MeetingInvitation" ADD COLUMN "notificationReadAt" timestamptz(3);
ALTER TABLE "Habit"
  ADD COLUMN "category" varchar(100),
  ADD COLUMN "unitLabel" varchar(100),
  ADD COLUMN "timeOfDay" varchar(10) NOT NULL DEFAULT 'ANYTIME',
  ADD COLUMN "preferredTime" char(5),
  ADD CONSTRAINT "Habit_timeOfDay_check" CHECK ("timeOfDay" IN ('ANYTIME','MORNING','AFTERNOON','EVENING')),
  ADD CONSTRAINT "Habit_preferredTime_check" CHECK ("preferredTime" IS NULL OR "preferredTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "Habit_category_check" CHECK ("category" IS NULL OR length(btrim("category")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "Habit_unitLabel_check" CHECK ("unitLabel" IS NULL OR length(btrim("unitLabel")) BETWEEN 1 AND 100);

ALTER TABLE "Habit"
  ADD COLUMN "icon" varchar(16) NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN "reminder" jsonb,
  ADD CONSTRAINT "Habit_icon_check" CHECK ("icon" IN ('DEFAULT','WATER','BOOK','EXERCISE','SLEEP','FOOD','MEDITATION','STUDY','WORK','HEALTH')),
  ADD CONSTRAINT "Habit_reminder_check" CHECK ("reminder" IS NULL OR
    (jsonb_typeof("reminder") = 'object' AND "reminder" ?& ARRAY['time','ifNotDone'] AND
     ("reminder" - 'time' - 'ifNotDone') = '{}'::jsonb AND
     jsonb_typeof("reminder"->'time') = 'string' AND
     "reminder"->>'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
     jsonb_typeof("reminder"->'ifNotDone') = 'boolean'));
ALTER TABLE "Reminder" ADD COLUMN "habitId" uuid,
  ADD CONSTRAINT "Reminder_spaceId_habitId_fkey" FOREIGN KEY ("spaceId","habitId")
    REFERENCES "Habit"("spaceId","id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "Reminder_one_source_check" CHECK (num_nonnulls("taskId","routineId","habitId") <= 1);
CREATE INDEX "Reminder_spaceId_habitId_idx" ON "Reminder"("spaceId","habitId");

ALTER TABLE "ContextInvitation"
  ADD COLUMN "notificationReadAt" timestamptz(3),
  ADD COLUMN "encryptedDeliveryProof" text,
  ADD COLUMN "deliveryAttempts" integer NOT NULL DEFAULT 0 CHECK ("deliveryAttempts" BETWEEN 0 AND 5),
  ADD COLUMN "deliveryNotBefore" timestamptz(3) NOT NULL DEFAULT now();
ALTER TABLE "ConversationEmailInvitation"
  ADD COLUMN "encryptedDeliveryProof" text,
  ADD COLUMN "deliveryAttempts" integer NOT NULL DEFAULT 0 CHECK ("deliveryAttempts" BETWEEN 0 AND 5),
  ADD COLUMN "deliveryNotBefore" timestamptz(3) NOT NULL DEFAULT now();
ALTER TABLE "MeetingEmailInvitation"
  ADD COLUMN "encryptedDeliveryProof" text,
  ADD COLUMN "deliveryAttempts" integer NOT NULL DEFAULT 0 CHECK ("deliveryAttempts" BETWEEN 0 AND 5),
  ADD COLUMN "deliveryNotBefore" timestamptz(3) NOT NULL DEFAULT now();
CREATE INDEX "ContextInvitation_delivery_idx" ON "ContextInvitation"("deliveryNotBefore",id)
  WHERE "encryptedDeliveryProof" IS NOT NULL AND state='PENDING';
CREATE INDEX "ConversationEmailInvitation_delivery_idx" ON "ConversationEmailInvitation"("deliveryNotBefore",id)
  WHERE "encryptedDeliveryProof" IS NOT NULL;
CREATE INDEX "MeetingEmailInvitation_delivery_idx" ON "MeetingEmailInvitation"("deliveryNotBefore",id)
  WHERE "encryptedDeliveryProof" IS NOT NULL;

ALTER TABLE "ContextInvitation"
  ADD COLUMN "staffFieldsProvided" boolean NOT NULL DEFAULT false,
  ADD COLUMN "staffPosition" varchar(300),
  ADD COLUMN "staffSupervisorAccessId" uuid,
  ADD COLUMN "staffSupervisorGeneration" integer,
  ADD CONSTRAINT "ContextInvitation_staffSupervisor_fkey" FOREIGN KEY ("spaceId","staffSupervisorAccessId") REFERENCES "ContextAccess"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "ContextInvitation_staffSupervisorInterval_fkey" FOREIGN KEY ("staffSupervisorAccessId","staffSupervisorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "ContextInvitation_staff_check" CHECK (
    (("staffSupervisorAccessId" IS NULL) = ("staffSupervisorGeneration" IS NULL)) AND
    (NOT "staffFieldsProvided" OR "companyScopeId" IS NOT NULL));

CREATE TABLE "InvitationPushAttempt" (
  id uuid PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  "subscriptionId" uuid NOT NULL REFERENCES "PushSubscription"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  "subscriptionRevision" integer NOT NULL CHECK ("subscriptionRevision" > 0),
  module varchar(20) NOT NULL CHECK (module IN ('PROJECTS','TEAMS','COMPANY','MESSAGING_MEETINGS','SOCIAL')),
  "contextInvitationId" uuid REFERENCES "ContextInvitation"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  "conversationInvitationId" uuid REFERENCES "ConversationInvitation"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  "meetingInvitationId" uuid REFERENCES "MeetingInvitation"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  state varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','RETRY','PROCESSING','DELIVERED','CANCELED','FAILED','AMBIGUOUS')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "notBefore" timestamptz(3) NOT NULL DEFAULT now(),
  "leaseUntil" timestamptz(3),
  "networkStartedAt" timestamptz(3),
  CONSTRAINT "InvitationPushAttempt_one_source_check" CHECK (num_nonnulls("contextInvitationId","conversationInvitationId","meetingInvitationId") = 1)
);
CREATE INDEX "InvitationPushAttempt_state_notBefore_idx" ON "InvitationPushAttempt"(state,"notBefore");
CREATE UNIQUE INDEX "InvitationPushAttempt_context_subscription_key" ON "InvitationPushAttempt"("contextInvitationId","subscriptionId") WHERE "contextInvitationId" IS NOT NULL;
CREATE UNIQUE INDEX "InvitationPushAttempt_conversation_subscription_key" ON "InvitationPushAttempt"("conversationInvitationId","subscriptionId") WHERE "conversationInvitationId" IS NOT NULL;
CREATE UNIQUE INDEX "InvitationPushAttempt_meeting_subscription_key" ON "InvitationPushAttempt"("meetingInvitationId","subscriptionId") WHERE "meetingInvitationId" IS NOT NULL;
