-- Forward-only strengthening: JSON null/string versions must not satisfy CHECK via UNKNOWN.
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "HabitSchedule_numeric_version_required" CHECK (definition @> '{"version":1}'::jsonb);
