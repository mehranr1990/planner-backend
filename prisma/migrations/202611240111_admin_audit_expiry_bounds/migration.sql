-- A missing SQL argument must have no effects, including invocations outside
-- the HTTP contract. STRICT preserves the existing non-null range checks.
ALTER FUNCTION admin_expire_audit_evidence(text,integer) STRICT;
