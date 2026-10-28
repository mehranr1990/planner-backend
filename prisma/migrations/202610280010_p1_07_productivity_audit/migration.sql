
-- Preserve the original account-only changedFields invariant; separate typed Task metadata.
ALTER TABLE "SecurityAuditEvent" ADD COLUMN "productivityFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_productivity_fields" CHECK ("productivityFields" <@ ARRAY['estimatedMinutes','important','urgent']::text[] AND cardinality("productivityFields")<=3);
