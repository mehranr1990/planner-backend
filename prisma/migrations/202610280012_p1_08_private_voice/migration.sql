-- ADR 0015 approved by owner: data-preserving MIME CHECK expansion only.
BEGIN;
ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_mime_check";
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_mime_check" CHECK ("mimeType" IN ('text/plain','application/pdf','image/png','image/jpeg','audio/wav'));
COMMIT;
