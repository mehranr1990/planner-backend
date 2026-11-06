BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION shared_purge_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j.generation=c."closureGeneration" WHERE c."spaceId"=target AND c.kind IN ('PROJECT','TEAM') AND c.state='PURGING' AND j.state='PURGING' AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$' AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL' WHERE a."spaceId"=target AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt")))
$$;
COMMIT;
