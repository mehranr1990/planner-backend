# 0015: Private voice files without changing earlier file API contracts

Status: APPROVED by owner, 2026-10-28, for the P1-08 voice-file prerequisite.

## Concrete conflict

P1-08 requires private voice memo attachments. Both FileMimeSchema and the applied
StoredFile_mime_check constraint permit only text/plain, application/pdf, image/png
and image/jpeg. No audio upload is currently possible. The migration review gate
correctly rejects unreviewed constraint drops; earlier file API compatibility
snapshots also intentionally lock the four-type contract.

## Approved decision

- Add dedicated /files/voice/uploads, /files/voice/{id}/complete,
  /files/voice/{id}/download and /files/voice/{id} DELETE routes, using the existing
  verified ownership resolver, private StoragePort, byte limits/hash validation,
  cancellation/cleanup, expiring authenticated downloads, audit and throttling.
  Do not expand the previous FileUpload/StoredFile response schemas. Old file
  routes reject voice-file IDs safely, and voice routes reject nonvoice IDs.
- Support audio/wav only in P1-08: strict canonical PCM WAV header,16-bit mono/stereo,
  sample rate8000-96000Hz, consistent byte rate/block alignment/RIFF/data lengths,
  maximum10MiB (also subject to any lower configured file limit). Validate actual
  bytes at completion. Downloads remain application/octet-stream attachments,
  never public/static/inline. No decoder, transcoder, recording UI, transcription
  or dependency is added. Other audio containers remain unsupported.
- Add a single reviewed forward migration that atomically replaces only
  StoredFile_mime_check with the same four existing values plus audio/wav.
  BEGIN/COMMIT protects the replacement; no table, column, row or earlier migration
  is deleted/rewritten. This is a data-preserving CHECK expansion, not a database
  reset or destructive schema/data change.
- Teach the migration review gate to recognize only that explicitly owner-approved
  migration by exact expected SQL/hash. Keep generic rejection of constraint
  drops and all other destructive/unreviewed migrations. Add tests that reject
  any altered SQL and preserve all earlier migration/compatibility gates.
- Capture links an owned READY voice StoredFile through a scoped FK and retains
  the source file reference after explicit conversion/archive. Existing file
  deletion/access policies remain authoritative. No extra attachment entity.

## Verification and alternatives

Test valid/mismatched/truncated WAV, oversize/type/owner denial, old-route rejection,
private downloads, cancellation/deletion, capture source ownership, prior API
compatibility, exact migration exception validation, all earlier data/defaults and
compiled restart persistence. Check all applied migration checksums in both DBs.

Expanding the old transport MIME enum changes previously approved responses.
Encoding audio as fake text/PDF misstates its type. An extra storage entity/provider
duplicates infrastructure. Dedicated voice contracts plus a narrowly reviewed
CHECK expansion meet P1-08 without those changes.

Owner approval: Explicit approval of this proposal in the P1-08 session.
