-- Acquire the privacy fence before source row locks, including FK cascades.
CREATE FUNCTION product_analytics_delete_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('planner.analytics_retention',true) IS DISTINCT FROM 'on' THEN
  PERFORM id FROM "ProductAnalyticsPolicy" WHERE id='GLOBAL' FOR UPDATE;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER product_analytics_delete_fence BEFORE DELETE ON "ProductAnalyticsEvent"
 FOR EACH STATEMENT EXECUTE FUNCTION product_analytics_delete_fence();
