-- Standalone Project activity remains in global analytics without falsely
-- attributing its independent custody to Personal, Team or Company.
ALTER TABLE "ProductAnalyticsEvent" DROP CONSTRAINT "ProductAnalyticsEvent_workspaceType_check";
ALTER TABLE "ProductAnalyticsEvent" ADD CONSTRAINT "ProductAnalyticsEvent_workspaceType_check"
 CHECK("workspaceType" IN ('PERSONAL','TEAM','COMPANY','OTHER'));
