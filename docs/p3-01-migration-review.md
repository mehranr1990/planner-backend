# P3-01 local migration review

Authorized scope: independent Teams, membership/roles and authorized Project
visibility. Owner confirmed multiple Teams may reference one Project on 2026-11-05.
This review authorizes no Shared activation or production/development deployment.

| Artifact                                          | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `202611050021_independent_teams/migration.sql`    | `48da56fbe30e2c356427bf115ac2ec4e66cbcdf954cede30b456801cf4151fc9` |
| `202611050022_team_reference_usage/migration.sql` | `7a3a95b9a1a9a0f1525efa59a53f555f5f3623c055da95d8cd1427d030fe91f6` |

Both artifacts are atomic, with five-second lock and 30-second statement timeouts.
They add Team and TeamProjectReference; widen only custody kind, admission role,
invitation role and the feature usage CHECK catalogs. Existing allowed values
remain. Context-specific role triggers reject Lead in Projects and Manager in
Teams. The immutable policy guard chooses the exact five-role catalog from custody
kind, retaining all ordinary capability ceilings and immutable publication rules.
New domain-root guards require matching Project/Team custody and immutable identity.
No Company kind, Company FK, account schema, existing data rewrite, backfill,
historical migration edit or deletion is introduced.

Team has mandatory root custody, scope and same-custody creator-actor FKs, plus
`id = spaceId = scopeId`. Reference PK is `(teamId, projectId)`, with concrete Team
and Project FKs and a composite `(spaceId, projectId)` Project FK. A matching
Project pair unique key supports it. The Project lookup index covers reverse
references. There are no cascading source deletions or authority-bearing links.
Six new FKs are reviewed; previous FK definitions remain unchanged.

Projects owns reference rows and removes them in its bounded cleanup pass before
Project roots. The updated complete FK catalog digest is
`b62245279caa9008934d9b375834c40f32d2e214ce2ffaacb77a0df5b89fb965`.
Unknown FKs still block cleanup. Independent Team lifecycle operations/purge are
P3-05; no new Team deletion endpoint or worker purge path is enabled. Existing
account closure immediately denies Team access and retains durable frozen/closing
metadata. Team closure cannot erase an independently referenced Project.

The reference usage companion registers `team.project-reference` without rewriting
the already rehearsed first artifact. Retained-reference growth is checked and
counted once inside the dual-custody transaction. Initial PUT replay, unlink and
reactivation do not create a second retained record. Free mode stays enabled.

Lock impact: CHECK validation scans the small kernel catalogs; unique index
creation scans Project; trigger replacement and CREATE/ALTER DDL take ordinary
catalog/table locks. There is no source-table rewrite. Measure target sizes and
lock availability before any non-isolated promotion. Roll back code only before
Team writes; afterward use a compatible release or forward correction. Never
drop Team data, custody kinds, signed evidence or compatibility structures.

The migration gate recognizes only these exact filenames/hashes; generic DROP,
procedural SQL and destructive forms remain rejected. The populated upgrade
extends the existing prior-release rehearsal: snapshot all 135 prior table data
sets, compare all 44 historical checksums and every prior constraint, permit only
the four listed CHECK widenings, interrupt each artifact before COMMIT, resume,
repeat deploy and verify the full cleanup FK digest. Empty replay and hostile
domain/role constraints are exercised separately. Existing configured databases
are never reset; only owned disposable fixture schemas are removed.

Security closeout baseline: `0074328`, including immutable migration
`202611050020_local_security_closeout`, remains the predecessor. Purpose-separated
keys, signed restrictive replay, retention ID uniqueness, evidence floors and
guarded disposal remain active. Replay additionally admits the typed Lead role;
existing Project/Personal evidence shapes and key handling remain compatible.
