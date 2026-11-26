BEGIN;
ALTER TABLE "P4Notice" ADD COLUMN "inApp" boolean NOT NULL DEFAULT true,
 ADD COLUMN "deliveryState" varchar(16) NOT NULL DEFAULT 'PENDING',
 ADD COLUMN attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN "leaseUntil" timestamptz(3),
 ADD COLUMN "nextAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "lastCode" varchar(80);
ALTER TABLE "P4Notice" ADD CONSTRAINT "P4Notice_delivery_check" CHECK ("deliveryState" IN ('PENDING','SENDING','SENT','SUPPRESSED','FAILED','AMBIGUOUS') AND attempts BETWEEN 0 AND 5);
CREATE INDEX "P4Notice_delivery_idx" ON "P4Notice"("deliveryState","nextAt");
CREATE TABLE "P4CommunicationPreference" ("userId" uuid NOT NULL,kind varchar(12) NOT NULL,"inApp" boolean NOT NULL DEFAULT true,email boolean NOT NULL DEFAULT true,"webPush" boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,PRIMARY KEY("userId",kind),CONSTRAINT "P4CommunicationPreference_user_fk" FOREIGN KEY("userId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,CONSTRAINT "P4CommunicationPreference_check" CHECK (kind IN ('SYSTEM','DIRECT','GROUP','GLOBAL') AND revision>0));
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_source_check" CHECK (num_nonnulls("taskId","noteId","messageId")<=1 AND ("taskId" IS NULL OR "sourceKind"='TASK') AND ("noteId" IS NULL OR "sourceKind"='NOTE') AND ("messageId" IS NULL OR "sourceKind"='MESSAGE'));
COMMIT;
