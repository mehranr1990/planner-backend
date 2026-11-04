BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Values and selections are replaced atomically by their owner. In-place changes
-- must not move a published default into a mutable Task row or change its parent.
CREATE TRIGGER "TaskFieldValue_no_update" BEFORE UPDATE ON "TaskFieldValue" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
CREATE TRIGGER "TaskFieldSelection_no_update" BEFORE UPDATE ON "TaskFieldSelection" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
COMMIT;
