BEGIN;
-- Legacy pins retain unknown pin time; never manufacture historical attribution.
ALTER TABLE "AnnouncementVersion" ADD COLUMN "pinnedAt" timestamptz(3);
COMMIT;
