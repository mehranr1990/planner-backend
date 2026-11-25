BEGIN;
SET LOCAL lock_timeout='5s';
-- Capture only historical terminal projections. The live triggers already cover
-- concurrent completions. A repeated projection cannot replace earlier evidence.
WITH events AS (
 SELECT 'ADMIN'::text source,id,action,outcome,"actorAdminId" actor,"targetUserId" target_user,
        "targetSpaceId" target_space,"requestId",reason,"createdAt"::timestamptz stamp
 FROM "AdminAuditEvent" WHERE outcome IN ('SUCCEEDED','DENIED','FAILED')
 UNION ALL
 SELECT 'USER_SECURITY',id,action,outcome::text,"actorUserId",NULL::uuid,NULL::uuid,"requestId",NULL,"occurredAt"
 FROM "SecurityAuditEvent" WHERE outcome::text IN ('SUCCEEDED','DENIED','FAILED') AND admin_audit_category(action)<>'CONTROL'
)
INSERT INTO "AdminAuditEvidence"(source,"eventId",category,action,outcome,"actorId","targetUserId","targetSpaceId","requestId",reason,digest,"createdAt")
SELECT source,id,admin_audit_category(action),action,outcome,actor,target_user,target_space,"requestId",reason,
 encode(sha256(convert_to(jsonb_build_object('source',source,'eventId',id,'action',action,'outcome',outcome,
 'actorId',actor,'targetUserId',target_user,'targetSpaceId',target_space,'requestId',"requestId",'reason',reason,'createdAt',stamp)::text,'UTF8')),'hex'),stamp
FROM events ON CONFLICT(source,"eventId") DO NOTHING;
COMMIT;
