# Social Photo Albums — deferred future contract

Status: **DEFERRED** (owner decision, P6-05, 2026-11-18). **Nothing here is implemented or
operational.** No album table, migration, API, controller, service, worker, image dependency,
signed URL or Frontend component exists. Shared file content remains blocked (ADR 0057) and the
Social media contract is design-only (ADR 0063). Implementation needs its own approved batch.

Labels: **APPROVED** = owner/product decision already recorded. **PROPOSED** = engineering
proposal that still needs owner/security approval.

## 1. Purpose and ownership

| #   | Item                                                                                                                                                         | Label    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1.1 | Albums are private image collections shared within an authorized Social Group or Activity.                                                                   | APPROVED |
| 1.2 | Each album belongs to exactly one Group or Activity (same XOR + CASCADE shape as `SocialGoal`). Album metadata is Social-owned; no second custody system.    | PROPOSED |
| 1.3 | Each image records its uploader. Uploading does not transfer Personal ownership of other data; the image belongs to the album's context for access purposes. | PROPOSED |

## 2. Permissions

| #   | Item                                                                                                                                                                                               | Label    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2.1 | Access only through the authorized context; rechecked on every list, metadata read and byte download.                                                                                              | APPROVED |
| 2.2 | View: current Group members / accepted Activity participants. Activity guests see only their Activity's albums, never Group albums (ADR 0051).                                                     | PROPOSED |
| 2.3 | Create album / add images: context members (or organizers only, owner to choose). Delete own image: uploader. Remove any image or album: context managers (Group Owner/Admin, Activity organizer). | PROPOSED |
| 2.4 | No public, anonymous, link-sharing or cross-context access; no global feed.                                                                                                                        | APPROVED |

## 3. Storage and access path

| #   | Item                                                                                                                                                     | Label    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3.1 | Bytes only through the existing private `StoragePort` volume; metadata and authorization in PostgreSQL.                                                  | APPROVED |
| 3.2 | Downloads stream through an authenticated API route bound to the image owner context; no public URLs, no proxy-mounted volume, no presigned/signed URLs. | PROPOSED |
| 3.3 | `Cache-Control: private, no-store` for originals; derived variants may use short private caching only after approval.                                    | PROPOSED |

## 4. Ingest, limits and safety

| #   | Item                                                                                                                                                                        | Label    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 4.1 | Original image maximum **20 MB** (initial), enforced as a streamed byte cap; Admin may later adjust within a hard security ceiling.                                         | APPROVED |
| 4.2 | Upload lands in quarantine; content sniffing must match the declared type; malware scanning by an approved scanner; release only on a clean result; rejected bytes deleted. | PROPOSED |
| 4.3 | Allowed types to evaluate: JPEG, PNG, WebP; HEIC only with a vetted decoder. No SVG, animated formats or video.                                                             | PROPOSED |
| 4.4 | Pixel cap (e.g. 40 MP) and decompression-bomb guard before any decode; decoder runs with CPU, memory and time limits.                                                       | PROPOSED |
| 4.5 | No scanner, codec or image library is approved today (V3 PG-10); choosing one requires the dependency approval process.                                                     | APPROVED |

## 5. Variants and metadata

| #   | Item                                                                                                                                                         | Label    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 5.1 | Display copies omit location metadata.                                                                                                                       | APPROVED |
| 5.2 | Thumbnail and display variants generated by a bounded `pg-boss` worker after release; job is idempotent and rechecks image state and context before writing. | PROPOSED |
| 5.3 | Strip all EXIF/XMP/IPTC (including GPS) from every variant; originals either stripped on ingest or kept but never served to non-uploaders (owner to choose). | PROPOSED |
| 5.4 | Original and all variants share one lifecycle and are disposed together.                                                                                     | PROPOSED |

## 6. Quota

| #   | Item                                                                                                                                                                       | Label    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 6.1 | Workspace storage quota configurable later in Phase 7 Admin; no unlimited assumption.                                                                                      | APPROVED |
| 6.2 | Usage counted per context (Group/Activity) and per uploading account through the existing feature-policy seam once quota keys are approved; originals plus variants count. | PROPOSED |

## 7. Replacement, deletion, recovery and erasure

| #   | Item                                                                                                                                                                         | Label                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 7.1 | Replacing an image creates a new image record; the old one follows deletion.                                                                                                 | PROPOSED             |
| 7.2 | Deleted images/albums follow the 30-day Social recovery window (ADR 0060 B), then bytes and variants are disposed in a committed job; backups follow operator policy.        | PROPOSED             |
| 7.3 | Account erasure: the person's uploads are deleted (default) or kept anonymized for the context (owner to choose); captions and the person's metadata are removed either way. | PROPOSED             |
| 7.4 | Retention durations beyond the recovery window depend on the Social retention policy.                                                                                        | POLICY-GATED (P6-06) |

## 8. Departure effects

| #   | Item                                                                                                                                              | Label    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 8.1 | Leaving or removal from the Group/Activity revokes album access immediately (per-request authorization; no grants to revoke).                     | APPROVED |
| 8.2 | The departed person's images stay in the album for the remaining members unless they delete them before leaving or erase their account (see 7.3). | PROPOSED |

## 9. Future API and schema considerations (PROPOSED)

- Tables: `SocialAlbum` (context XOR, title, revision), `SocialAlbumImage` (album, uploader,
  state `QUARANTINED`/`READY`/`REJECTED`/`DELETED`, byte size, type, pixel dims, storage keys),
  `SocialAlbumVariant` (image, kind, storage key). Same-context composite keys; user FKs SET NULL.
- Routes: `/social-albums` CRUD scoped by `groupId`/`activityId`; `/social-albums/{id}/images`
  upload-initiate/complete; `/social-album-images/{id}/content?variant=` streamed download.
  Idempotency keys, `If-Match`, safe 404s, sensitive rate class for uploads and deletions.
- Notices would reuse the Social inbox with the context column (as goals do).

## 10. Dependencies before implementation

1. ADR 0057: lift local Shared file blocking for Social media (owner/security approval).
2. ADR 0063: approve the proposed technical policy (types, caps, quarantine, scanner, variants).
3. An approved scanner and image codec (new dependencies; V3 PG-10).
4. P6-06 Social retention policy for disposal beyond the recovery window.
5. Phase 7 quota keys/Admin for adjustable limits.
