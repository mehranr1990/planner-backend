# Social Goals and Challenges — Frontend handoff (P6-05)

Backend batch P6-05, ADR [0065](../adr/0065-social-goals-and-challenges.md). Contract:
[`openapi.json`](openapi.json) (1,295 operations; +13). Types: `@mehran/api-contracts`
(`social-goals.ts`). Local/isolated verification only — not Live. **Albums are not available**
(deferred; no album routes exist).

## Concepts

- **Kind** — `CHALLENGE`: each participant works toward the `target` on their own.
  `GOAL`: everyone contributes to one collective `target`.
- **Context** — exactly one of `groupId` (Social Group) or `activityId` (independent or
  Group Activity). Every list and create call names it.
- **Organizer** — not a new role: Group Owner/Admin, or the Activity organizer (and its
  Group's Owner/Admin). `viewer.organizer` tells you.
- **Participant** — a context member who explicitly joined. Membership never enrolls anyone.
- **Entry** — a `SUBMISSION` (self-reported, positive, dated) or an organizer `CORRECTION`
  (signed, with a reason). Only `APPROVED` entries count.
- **Badge** — `{ kind: 'COMPLETION', awardedAt }` on a participant: "completed this Social
  Goal/Challenge" only. Do not present it as verified, certified, ranked or rewarded.

## Routes (all under `/api/v1`, session cookie, `Cache-Control: no-store`)

| Method + path                                                                  | operationId                                               | Who                                             | Headers                  | Body → response                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `GET /social-goals`                                                            | `socialGoalsgetsocialgoals`                               | context member                                  | —                        | query → `SocialGoalPage`                                        |
| `POST /social-goals`                                                           | `socialGoalspostsocialgoals`                              | organizer                                       | Origin, Idempotency-Key  | `SocialGoalCreate` → `SocialGoal` (201, ETag)                   |
| `GET /social-goals/{id}`                                                       | `socialGoalsgetsocialgoalsid`                             | context member                                  | —                        | → `SocialGoal` (ETag)                                           |
| `PATCH /social-goals/{id}`                                                     | `socialGoalspatchsocialgoalsid`                           | organizer                                       | + If-Match (goal)        | `SocialGoalPatch` → `SocialGoal`                                |
| `POST /social-goals/{id}/actions/{close\|cancel}`                              | `socialGoalspostsocialgoalsidactionsaction`               | organizer                                       | + If-Match (goal)        | `{}` → `SocialGoal`                                             |
| `POST /social-goals/{id}/join`                                                 | `socialGoalspostsocialgoalsidjoin`                        | context participant                             | Origin, Idempotency-Key  | `{}` → `SocialGoalParticipant`                                  |
| `POST /social-goals/{id}/withdraw`                                             | `socialGoalspostsocialgoalsidwithdraw`                    | the participant                                 | + If-Match (participant) | `{}` → `SocialGoalParticipant`                                  |
| `GET /social-goals/{id}/participants`                                          | `socialGoalsgetsocialgoalsidparticipants`                 | organizer / participant                         | —                        | `limit`,`after` → `SocialGoalParticipantPage`                   |
| `GET /social-goals/{id}/entries`                                               | `socialGoalsgetsocialgoalsidentries`                      | organizer / participant                         | —                        | `state`,`participantId`,`limit`,`after` → `SocialGoalEntryPage` |
| `POST /social-goals/{id}/entries`                                              | `socialGoalspostsocialgoalsidentries`                     | active participant (self)                       | Origin, Idempotency-Key  | `SocialGoalEntryCreate` → `SocialGoalEntry`                     |
| `POST /social-goals/{id}/entries/{entryId}/actions/{approve\|reject\|retract}` | `socialGoalspostsocialgoalsidentriesentryIdactionsaction` | organizer (approve/reject); submitter (retract) | + If-Match (entry)       | `{ note? }` → `SocialGoalEntry`                                 |
| `POST /social-goals/{id}/corrections`                                          | `socialGoalspostsocialgoalsidcorrections`                 | organizer                                       | + If-Match (participant) | `SocialGoalCorrectionCreate` → `SocialGoalEntry`                |
| `GET /social-goals/{id}/history`                                               | `socialGoalsgetsocialgoalsidhistory`                      | organizer / participant                         | —                        | → `SocialGoalHistory` (≤1,000, `truncated`)                     |

Write calls need `Origin` and `Idempotency-Key` (1–128 printable ASCII). Replay with the same key
and body returns the original result; same key with a different body → 409
`IDEMPOTENCY_CONFLICT`. `If-Match` is `"<revision>"`; use the `ETag`/`revision` you last read.
Unknown body or query fields → 400.

## Key types

```ts
SocialGoalCreate = { id: uuid; kind: 'GOAL'|'CHALLENGE'; groupId?: uuid|null; activityId?: uuid|null;
  title: string(1..200); description?: string|null(≤2000); unit: string(1..40);
  target: int(1..1e9); startsOn: 'YYYY-MM-DD'; endsOn: 'YYYY-MM-DD'; timezone: IANA;
  reviewRequired?: boolean /* default false */ }        // exactly one of groupId/activityId
SocialGoalPatch = { title?; description?; target?; endsOn?; reviewRequired? } // ≥1 field
SocialGoal = { id; kind; groupId; activityId; title; description; unit; target; startsOn; endsOn;
  timezone; reviewRequired; state: 'ACTIVE'|'CLOSED'|'CANCELED'; window: 'UPCOMING'|'OPEN'|'ENDED';
  createdByUserId; completedAt /* GOAL only */; closedAt;
  aggregate: { participantCount; completedCount; approvedTotal; percent; pendingReviewCount: number|null };
  viewer: { organizer: boolean; independentReviewerAvailable: boolean;
    participant: SocialGoalParticipant|null };
  revision; createdAt; updatedAt }
SocialGoalParticipant = { id; goalId; userId: uuid|null; state: 'ACTIVE'|'WITHDRAWN'; joinedAt;
  withdrawnAt; approvedTotal; pendingTotal: number|null; percent; completed; badge; revision }
SocialGoalEntryCreate = { id: uuid; amount: int(1..1e9); occurredOn: 'YYYY-MM-DD'; note?: string|null(≤1000) }
SocialGoalCorrectionCreate = { id: uuid; participantId: uuid; delta: int≠0 (±1e9);
  reason: string(1..1000); correctsEntryId?: uuid|null }
SocialGoalEntry = { id; goalId; participantId; participantUserId; kind: 'SUBMISSION'|'CORRECTION';
  amount; occurredOn|null; note /* reason for corrections */; state: 'PENDING'|'APPROVED'|'REJECTED'|'RETRACTED';
  submittedByUserId; submittedAt; reviewedByUserId; reviewedAt; reviewNote; correctsEntryId; revision }
```

`GET /social-goals` query: exactly one of `groupId`/`activityId`; optional `kind`, `state`,
`participation` (`ANY` default, `JOINED`, `NOT_JOINED`), `limit` (1–100, default 25), `after`
(opaque `nextCursor`). Results are ordered by id; cursors are bound to the caller and filters.

## Lifecycle

- Goal: `ACTIVE` → `CLOSED` (no joins/submissions; pending entries still reviewable and
  correctable) or `CANCELED` (read-only). Both are final; goals are never deleted.
- `window` is derived from `startsOn`/`endsOn` in the goal's `timezone`. Join while `UPCOMING` or
  `OPEN`; submit only while `OPEN`, for an `occurredOn` within the window and not after today in
  that time zone. Window ≤ 731 days; creation of an already-ended window is refused.
- Activity goals also need the Activity to be `PLANNED` for create/join/submit.
- Entry: `PENDING` → `APPROVED`/`REJECTED` (organizer) or `RETRACTED` (submitter). An
  unreviewed self-reported `APPROVED` entry can also be `RETRACTED` by its submitter.
  Corrections are `APPROVED` immediately and never change the original submission.
- Participant: `ACTIVE` ⇄ `WITHDRAWN`. Withdrawal retracts the person's pending entries and keeps
  approved progress; rejoining restores it.

## Opt-in and review rules

- Show "Join" only when `viewer.participant` is null or `WITHDRAWN`. Never auto-join on create.
- `reviewRequired: false` (default): submissions count immediately. `true`: they are `PENDING`
  until an organizer decides. Show pending as "awaiting review", never inside totals.
- Nobody approves their own progress — including a sole organizer. Organizers cannot review
  their own entries or correct their own record (`SELF_REVIEW_FORBIDDEN`); another organizer
  must. There is no auto-approval and no temporary reviewer.
- `viewer.independentReviewerAvailable` is `false` when no current organizer other than the
  caller exists. If it is `false` and `reviewRequired` is `true`, warn before submitting: the
  entry will stay `PENDING` (not counted) until another organizer exists and approves it.

## Progress, completion and visibility

- `percent = floor(total × 100 / target)`, capped at 100. Participant `percent` is their own
  approved total against `target` (for `GOAL`, their share of the collective target).
- Aggregate: `GOAL` → `percent` of collective `approvedTotal`; `CHALLENGE` → share of current
  participants who completed. `approvedTotal` includes contributions of former participants.
- `CHALLENGE` badge: when the participant's approved total reaches `target`. `GOAL` badge: every
  participant active when the collective total reached `target` (then `completedAt` is set and
  joining closes). A later correction or target change below the target removes the badge.
- No leaderboards or rankings: do not sort participants by progress or show positions.
- Non-participating members: goal + aggregate only (`/participants`, `/entries`, `/history` →
  403 `GOAL_PARTICIPATION_REQUIRED`). Participants: peers' approved totals and approved entries,
  plus all of their own. Organizers: everything for current members, incl. `pendingReviewCount`.
  A withdrawn member sees only their own record. Removed members disappear from peer views.
- Never show Personal Goals, Habits, Focus, Mood, Journal or Finance data here; nothing is linked.

## Notices (`GET /social-notices`, polled)

New `kind`s with `groupId` or `activityId` set and `resourceId` = goal id:
`GOAL_ENTRY_SUBMITTED` (organizers; review-required goals), `GOAL_ENTRY_DECIDED` (submitter),
`GOAL_CORRECTED` (participant), `GOAL_COMPLETED` (badge awarded), `GOAL_ENDED` (closed/canceled,
active participants). Re-read the goal for details; notices carry no amounts or notes.

## Errors

| Status | `code`                                                                                                                                                                                                                                                                                                      | Meaning                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 400    | —, `IDEMPOTENCY_KEY_REQUIRED`                                                                                                                                                                                                                                                                               | Schema, unknown field, missing header                                            |
| 403    | `ORGANIZER_REQUIRED`, `GOAL_PARTICIPATION_REQUIRED`, `CONTEXT_PARTICIPATION_REQUIRED`, `SELF_REVIEW_FORBIDDEN`, `NOT_SUBMITTER`, `ACTIVITY_PERMISSION_REQUIRED`                                                                                                                                             | Authorized context, missing role or participation                                |
| 404    | —                                                                                                                                                                                                                                                                                                           | Not found or not visible (indistinguishable)                                     |
| 409    | `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `ALREADY_JOINED`, `NOT_PARTICIPATING`, `GOAL_NOT_ACTIVE`, `GOAL_COMPLETED`, `WINDOW_NOT_OPEN`, `WINDOW_ENDED`, `CONTEXT_NOT_OPEN`, `ENTRY_EXISTS`, `GOAL_EXISTS`, `ENTRY_NOT_PENDING`, `ENTRY_NOT_RETRACTABLE`, `ENTRY_NOT_REVIEWABLE`, `PARTICIPANT_INACTIVE` | State or concurrency conflict: re-read, then retry if still valid                |
| 413    | —                                                                                                                                                                                                                                                                                                           | Bound reached (500 goals/context, 5,000 participants, 1,000 entries/participant) |
| 422    | `OUTSIDE_WINDOW`, `WINDOW_ENDED`, `WINDOW_TOO_LONG`, `INVALID_WINDOW`, `NEGATIVE_TOTAL`, `INVALID_CORRECTION_TARGET`                                                                                                                                                                                        | Valid shape, invalid values                                                      |
| 429    | —                                                                                                                                                                                                                                                                                                           | Rate limit (close/cancel, review, correction and join are sensitive)             |

On a network retry, resend with the **same** `Idempotency-Key` and entry `id`; a new key with the
same entry `id` returns `ENTRY_EXISTS` and the progress is not counted twice.

## Deferred / not available

Photo Albums (no routes; see [deferred contract](../architecture/social-albums-deferred-contract.md)),
linking Personal Habits/Goals as progress sources, proof uploads, push/realtime (poll notices),
leaderboards, rankings, XP, rewards or penalties, retention durations (P6-06).
