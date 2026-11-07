# P4-05 migration review

M033: `202611070033_company_knowledge_and_reports`.
SHA-256: `dd0578829944930aab32b124b40315c500b9ba5f05ba8e8130cb00fe486f627a`.

Three additive entities: CompanyKnowledgeFolder, CompanyKnowledgeDocument and
CompanyKnowledgeVersion. Same-Company/context compound FKs bind folder hierarchy,
document/current publication, document version, StoredFile and the initiating
admission interval. File identity equals its version identity; financial receipts
cannot be rebound as knowledge. No User FK or source Project FK is added.

Thirteen additional FKs produce **584** total. Reviewed catalog SHA-256:
`9e1e5dc7b2ebe04f0180fc0892dcab5be1e510a593578597d4d714cef1809094`.
Company cleanup/restore remains quarantined pending its P4-06 lifecycle consumer;
new references cannot be silently disposed by an earlier consumer. Existing
Personal identity erasure retains only opaque shared publisher attribution.

Database guards enforce immutable ownership and version snapshots, cycle/depth
bounds, fixed folder parent, a published current-version pointer, ready file/hash/
revision pinning, immutable published bytes and retained published version history.
No table/data removal, cascade, external provider, schema reset or production
mutation. The existing usage CHECK is widened only by three knowledge feature keys;
earlier feature values remain accepted. All **56 historical SQL artifacts** retain
their accepted bytes.

The mandatory rehearsal in `tooling/testing/company-knowledge-upgrade.ts` checks
179 populated predecessor datasets, 56 ledger checksums and all prior constraints
except that additive usage CHECK. It exercises interrupted rollback, repeat deploy,
populated new tables, forbidden version/file mutation and folder cycles, and the
584-FK digest. It runs in a newly owned, guarded local test schema; configured
databases are never reset. Evidence/results are recorded in the batch report.
