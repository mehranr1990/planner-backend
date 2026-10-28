-- ADR 0016 approved by owner: preserve all old capture target shapes and add exactly one Finance target.
BEGIN;
ALTER TABLE "CaptureItem" DROP CONSTRAINT "CaptureItem_target_values";
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_target_values" CHECK ((state='TRIAGED' AND num_nonnulls("targetTaskId","targetNoteId","targetJournalId","targetHabitEntryId","targetTransactionId")=1) OR (state IN ('INBOX','ARCHIVED') AND num_nonnulls("targetTaskId","targetNoteId","targetJournalId","targetHabitEntryId","targetTransactionId")=0));
COMMIT;
