-- G0 rehearsal candidate only. Not registered for application deployment.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TYPE "SpaceKind" ADD VALUE 'SHARED';
COMMIT;
