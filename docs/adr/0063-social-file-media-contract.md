# 0063: Social files and media — contract only (operations disabled)

Status: **APPROVED as a contract/design deliverable** (ADR 0060 decision E,
2026-11-18). **No file content operation is enabled.** Media support is not complete.

## Approved product limits

| Limit                                                               | Source                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| Social album originals: images only, at most **20 MB per original** | V3 01/03, ADR 0051 (subject to hard security constraints) |
| Album display copies omit location metadata                         | ADR 0051                                                  |
| Albums are private; media only via authorized context               | V3 01/03                                                  |
| Workspace storage quota adjustable later by administration          | V3 01                                                     |

## Proposed technical policy (NOT approved — requires owner/security approval)

| Area                    | Proposal                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership               | File metadata owned by Social, bound to exactly one Group or Activity; bytes only through the existing `StoragePort` private volume; access = current Group membership or accepted Activity participation, rechecked per download |
| Types                   | Proposal to evaluate: JPEG, PNG, WebP; HEIC only with a vetted decoder. No SVG, no animated formats, no video until separately approved                                                                                           |
| Size controls           | Streamed ingest with byte cap at 20 MB; pixel cap (e.g. 40 MP) and decompression guard to be approved                                                                                                                             |
| Quarantine and scanning | Uploads land quarantined; content sniffing must match declared type; malware scan via an approved scanner; release only on clean result                                                                                           |
| Derivatives             | Thumbnail/display copies generated in a bounded worker (CPU/memory/time limits) after release; EXIF/GPS stripped from display copies; originals' metadata policy to be approved                                                   |
| Quota                   | Per Group/Activity and per account, enforced through the feature-policy seam once keys are approved                                                                                                                               |
| Lifecycle               | Deleted files follow the 30-day Social recovery window (ADR 0060 B); originals and all derivatives disposed together; backups per operator policy                                                                                 |

## Blocked operations

Upload initiation, upload completion, download, thumbnail/derivative generation,
scanning integrations and album APIs are **not implemented**. ADR 0057 local
Shared test mode file blocking is unchanged. Enabling any of them requires
approval of the proposed technical policy, an approved scanner/codec dependency
(none approved; V3 PG-10), and implementation in its own batch.
