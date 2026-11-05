BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "SharedTaskWorkLog" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"taskId" uuid NOT NULL,"actorId" uuid NOT NULL,"accessId" uuid NOT NULL,generation integer NOT NULL,"startedAt" timestamptz(3) NOT NULL,"endedAt" timestamptz(3) NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"voidedAt" timestamptz(3),"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 CHECK("endedAt">"startedAt" AND "endedAt"<="startedAt"+interval '24 hours'),CHECK(date_trunc('second',"startedAt")="startedAt" AND date_trunc('second',"endedAt")="endedAt"),
 UNIQUE("accessId",generation,"creationKey"),FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION
);
CREATE INDEX "SharedTaskWorkLog_task_page" ON "SharedTaskWorkLog"("spaceId","scopeId","taskId",id);
CREATE INDEX "SharedTaskWorkLog_window" ON "SharedTaskWorkLog"("spaceId","scopeId","startedAt","endedAt",id) WHERE "voidedAt" IS NULL;
CREATE FUNCTION shared_task_work_log_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ContextAccess" WHERE id=NEW."accessId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" AND "actorId"=NEW."actorId") THEN RAISE EXCEPTION 'Work log author must match admission' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."spaceId",NEW."scopeId",NEW."taskId",NEW."actorId",NEW."accessId",NEW.generation,NEW."startedAt",NEW."endedAt",NEW."createdAt",NEW."creationKey",NEW.fingerprint) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."taskId",OLD."actorId",OLD."accessId",OLD.generation,OLD."startedAt",OLD."endedAt",OLD."createdAt",OLD."creationKey",OLD.fingerprint)) THEN RAISE EXCEPTION 'Recorded shared effort is immutable; void and replace' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "SharedTaskWorkLog_shape" BEFORE INSERT OR UPDATE ON "SharedTaskWorkLog" FOR EACH ROW EXECUTE FUNCTION shared_task_work_log_shape();
CREATE TRIGGER "SharedTaskWorkLog_no_delete" BEFORE DELETE ON "SharedTaskWorkLog" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
COMMIT;
