# P2-05 M07 migration review

Three explicit atomic migrations add 17 tables; no Personal or prior Shared row is
rewritten. All 33 existing migration artifacts remain unchanged. The only changed
prior constraint is SharedUsageEntry's additive feature allowlist; its six existing
keys remain. No existing FK, attribution branch or API enum changes.

- `202611040010_task_fields_and_dependencies`: ten tables for typed field registries,
  versions/options/values/selections, source metadata history, graph/edges and
  reschedule previews/items. Typed scope, Task, actor and admission-interval FKs;
  typed scalar and deferred selection checks; search indexes, retained history,
  custody-serialized cycle checks and immutable publication/manifest triggers.
  SHA-256: `ce23cdddf3a4a3578ee19cb187b19c1f786cd8b42851d22567c70e74258bdc9b`.
- `202611040011_task_workflows`: seven workflow registry/version/state/edge/approver,
  Task binding and approval tables. Concrete same-version/scope references,
  immutable publication, one pending request per Task, exact designated decision
  authority and terminal history checks.
  SHA-256: `1b3815e71697d9cfce5847bf2134108d61ffb86220ea297d77ae134096e82629`.

- `202611040012_task_tool_publication_updates`: blocks in-place value/selection
  reparenting; the owner replaces mutable Task values atomically. This closes a
  direct-SQL route for moving a published default into a mutable Task row, without
  editing the already rehearsed migration bytes.
  SHA-256: `4c99ee9a4ffd329e7965d610b0723821625d9f6a87ba4e1ab9431092b17df20a`.

All use five-second lock and 30-second statement timeouts. No destructive reset,
schema push, deployment or production DB operation is authorized. Review pins
exact bytes without weakening the generic migration gate.

The mandatory migration gate rehearses empty replay and populated M06 to M07 in
newly owned isolated namespaces: 98 prior table snapshots including assignments
and notifications, all prior constraints, 33 checksums, interruption/rollback of
each artifact, resume and repeated deployment. Only the allowlist extension may
differ. Real data volume and production timing remain operator release evidence.
