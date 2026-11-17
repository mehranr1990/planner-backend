# 0055: Company gap closure

Status: owner-approved development scope, 2026-11-16, through the explicit
P4-GAP-CLOSURE request. Operational policy approval and Shared activation remain
separate. This records that request and its implementation boundaries; it grants
no deployment, commit, push or production database authority.

Reuse ADRs 0034–0039 and 0043: explicit root/child admissions, generation-bound
authority, independent Team/Project custody, fixed administrative protections,
exact-money accounting, participant confidentiality and retention admission.

The existing financial approval instance/step/event engine additionally accepts a
typed budget-change request source. Its final decision invokes the existing budget
change command. Intermediate steps have no accounting effect. Legacy direct
workflows retain their approved behavior; a request bound to a controlled workflow
cannot use the direct decision path. Policy submission is explicit and fails
closed without exactly one matching published version. Explicit restart selects
the current applicable policy and cannot substitute a nonmatching workflow.

Tier values, currency, category, effective dates and escalation duration come from
authorized explicit configuration. No values are seeded. Ordered distinct named
reviewers and alternates remain generation-bound. Temporary delegation requires
both parties' current financial authority, cannot chain, cannot approve the
requester's/beneficiary's own request and cannot collapse distinct stages into
one acting person. Decisions record the actual actor and delegation basis.

Custom roles and temporary grants use the existing configurable Company keys
`structure.read` and `directory.read`. They require existing exact-scope admission
and cannot override mandatory/optional policy ceilings. Fixed Owner, administrative
and financial powers remain reserved to existing membership roles. Grant expiry
is checked during authorization. Access-review revocation removes additional
grants; membership changes continue through the existing protected APIs.

Physical custody is distinct from booking, maintains immutable issue/return facts
and never transfers ownership. Scheduled/in-progress maintenance conservatively
blocks new allocation/custody until explicitly completed or canceled; no maintenance
duration or service interval is inferred. Occupancy reports describe recorded
reservations, custody separately describes possession, and neither proves attendance.

KPI observations are explicitly recorded evidence, never reconstructed snapshots.
Review cycles use explicit periods and participants. The named current reviewer
submits; the subject completes the review; a manager closes a cycle only after all
assigned reviews complete. Bodies are readable only by bound current participants.
One-on-one notes/actions remain private to the bound manager/employee. Original
note/review revisions are immutable except privacy redaction. No rating, compensation,
employment termination, public task or confidential attachment sharing is inferred.

Company handover retains provider password verification inside the accepting
transaction, terminal replay protection and existing seven-day offer expiry.
Acceptance revokes the former owner's sessions and the recipient's other sessions.
No separate reusable identity-proof token or new proof lifetime is introduced.
Invitation HTTP creation returns a null proof; only the verified recipient can
retrieve and rotate an acceptance proof. Resend exposes no proof.

Emergency recovery cases and governance drafts are persistable and auditable;
execution is unreachable. Draft values may be incomplete and never count as an
approved policy. Existing owner-exit lifecycle recovery is preserved independently.
Retention remains in the existing operator-approved immutable catalog. The draft
review checklist in the Company handoff supplies no legal periods or activation.

M073 introduces additive records and references. M074 adds history/redaction and
asset-retirement guards without rewriting M073 after its isolated-test application.
Company cleanup removes children before parents; Personal identity erasure clears
new private payloads while retaining opaque structural evidence. The reviewed
cleanup catalog covers 1,067 foreign keys. Historical migrations and API baselines
remain intact; exact contract extensions are separately pinned.

Published matching tier policies also block legacy fixed-reviewer expense submission and direct budget decisions. Explicit workflow submissions must select the matching policy workflow and pin its version; uncovered requests retain approved legacy behavior. Policy-required budget requests expose `can.decide:false` until handled through the controlled engine. No threshold or policy is activated by default.

Archiving an applicable approved tier version keeps new matching submissions fail-closed until a replacement is published or the explicitly recorded effective-until expires; archival never silently re-enables a weaker legacy path.
