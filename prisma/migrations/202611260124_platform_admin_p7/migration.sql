CREATE TABLE "ProductAnalyticsPolicy" (
 id varchar(10) PRIMARY KEY CHECK (id='GLOBAL'), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 product boolean NOT NULL DEFAULT true, navigation boolean NOT NULL DEFAULT false,
 "rawDays" integer NOT NULL DEFAULT 90 CHECK("rawDays" BETWEEN 30 AND 365),
 "aggregateDays" integer NOT NULL DEFAULT 730 CHECK("aggregateDays" BETWEEN 30 AND 3650),
 "minimumCohort" integer NOT NULL DEFAULT 5 CHECK("minimumCohort" BETWEEN 5 AND 100),
 "refreshedAt" timestamptz(3), "startedAt" timestamptz(3) NOT NULL DEFAULT now()
);
INSERT INTO "ProductAnalyticsPolicy" (id) VALUES ('GLOBAL');
CREATE TABLE "ProductAnalyticsEvent" (
 id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "spaceId" uuid NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
 "scopeId" uuid REFERENCES "AccessScope"(id) ON DELETE CASCADE,
 "workspaceType" varchar(10) NOT NULL CHECK("workspaceType" IN ('PERSONAL','TEAM','COMPANY')),
 name varchar(100) NOT NULL CHECK(name IN ('task.created','task.completed','habit.entry_recorded','goal.progress_changed','capture.triaged','time_block.changed','finance.transaction_posted','navigation.viewed')),
 version integer NOT NULL CHECK(version=1), feature varchar(20) NOT NULL,
 meaningful boolean NOT NULL, "occurredAt" timestamptz(3) NOT NULL DEFAULT now(),
 CHECK (meaningful=(name<>'navigation.viewed')),
 CHECK (feature IN ('tasks','habits','goals','capture','calendar','finance','navigation'))
);
CREATE INDEX "ProductAnalyticsEvent_time_idx" ON "ProductAnalyticsEvent"("occurredAt",id);
CREATE INDEX "ProductAnalyticsEvent_user_idx" ON "ProductAnalyticsEvent"("userId","occurredAt");
CREATE TABLE "ProductAnalyticsDefinition" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision integer NOT NULL DEFAULT 1,
 name varchar(120) NOT NULL, kind varchar(10) NOT NULL CHECK(kind IN ('FUNNEL','KPI','COHORT')),
 events jsonb NOT NULL CHECK(jsonb_typeof(events)='array' AND jsonb_array_length(events) BETWEEN 1 AND 8),
 formula varchar(20) NOT NULL CHECK(formula IN ('COUNT','UNIQUE_USERS','RATIO','PER_ACTIVE_USER')),
 "windowDays" integer NOT NULL CHECK("windowDays" BETWEEN 1 AND 90)
);
CREATE TABLE "ProductAnalyticsAggregate" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), day date NOT NULL, "workspaceType" varchar(10) NOT NULL,
 feature varchar(20) NOT NULL, users integer NOT NULL CHECK(users>=0), events integer NOT NULL CHECK(events>=0),
 "refreshedAt" timestamptz(3) NOT NULL DEFAULT now(), UNIQUE(day,"workspaceType",feature)
);
CREATE TABLE "ProductAnalyticsReport" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "adminId" uuid NOT NULL REFERENCES "AdminUser"(id) ON DELETE CASCADE,
 filter jsonb NOT NULL, format varchar(4) NOT NULL CHECK(format IN ('CSV','JSON')),
 "intervalHours" integer CHECK("intervalHours" BETWEEN 1 AND 8760),
 "nextAt" timestamptz(3), state varchar(10) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','DENIED')),
 "expiresAt" timestamptz(3) NOT NULL, content text CHECK(octet_length(content)<=2000000),
 "createdAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "ProductAnalyticsReport_due_idx" ON "ProductAnalyticsReport"("nextAt");
-- Cached output must never survive deletion of its identifiable source evidence.
CREATE FUNCTION product_analytics_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('planner.analytics_retention',true)='on' THEN RETURN NULL; END IF;
 DELETE FROM "ProductAnalyticsAggregate";
 UPDATE "ProductAnalyticsReport" SET content=NULL,state='PENDING',"nextAt"=now();
 UPDATE "ProductAnalyticsPolicy" SET "refreshedAt"=NULL WHERE id='GLOBAL';
 RETURN NULL;
END $$;
CREATE TRIGGER product_analytics_erasure AFTER DELETE ON "ProductAnalyticsEvent"
 FOR EACH STATEMENT EXECUTE FUNCTION product_analytics_invalidate();
