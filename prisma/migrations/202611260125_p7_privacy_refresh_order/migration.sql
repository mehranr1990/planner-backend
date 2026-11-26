-- Shared policy fence orders collection, invalidation and aggregate refresh.
CREATE OR REPLACE FUNCTION product_analytics_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('planner.analytics_retention',true)='on' THEN RETURN NULL; END IF;
 PERFORM id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR UPDATE;
 DELETE FROM "ProductAnalyticsAggregate";
 UPDATE "ProductAnalyticsReport" SET content=NULL,state='PENDING',"nextAt"=now();
 UPDATE "ProductAnalyticsPolicy" SET "refreshedAt"=NULL WHERE id='GLOBAL';
 RETURN NULL;
END $$;
