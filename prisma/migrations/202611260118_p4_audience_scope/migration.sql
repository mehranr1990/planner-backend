BEGIN;
CREATE TABLE "AdminCommunicationTarget"("communicationId" uuid NOT NULL,"userId" uuid NOT NULL,"pushState" varchar(20) NOT NULL DEFAULT 'NOT_REQUESTED',PRIMARY KEY("communicationId","userId"),CONSTRAINT "AdminCommunicationTarget_campaign_fk" FOREIGN KEY("communicationId") REFERENCES "AdminCommunication"(id) ON DELETE CASCADE ON UPDATE NO ACTION,CONSTRAINT "AdminCommunicationTarget_user_fk" FOREIGN KEY("userId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,CONSTRAINT "AdminCommunicationTarget_state_check" CHECK("pushState" IN ('NOT_REQUESTED','AVAILABLE','NO_VALID_DEVICE')));
ALTER TABLE "ModerationCase" ADD COLUMN "targetScopeId" uuid;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_target_scope_fk" FOREIGN KEY("targetSpaceId","targetScopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE SET NULL ON UPDATE NO ACTION;
COMMIT;
