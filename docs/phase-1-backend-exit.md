# Phase 1 backend exit — local development

Status: COMPLETE for the approved local Windows/PostgreSQL scope. Deployment
release remains gated separately. No Phase 2 or frontend implementation started.

| Batch | Delivered backend scope                                    | Evidence                    |
| ----- | ---------------------------------------------------------- | --------------------------- |
| P1-01 | Tasks, nested checklists/labels/attachments/history        | [report](./p1-01-report.md) |
| P1-02 | Recurrence, occurrences, templates, bulk and saved filters | [report](./p1-02-report.md) |
| P1-03 | Personal planning, reviews, capacity and explicit rollover | [report](./p1-03-report.md) |
| P1-04 | Calendar events, recurrence and Time Blocks                | [report](./p1-04-report.md) |
| P1-05 | Habits, routines, water and historical streaks             | [report](./p1-05-report.md) |
| P1-06 | Life Areas, Goals, milestones, metrics and reviews         | [report](./p1-06-report.md) |
| P1-07 | Focus/Pomodoro and time tracking                           | [report](./p1-07-report.md) |
| P1-08 | Notes, private Journal/Mood, Capture and voice attachments | [report](./p1-08-report.md) |
| P1-09 | Exact personal finance, budgets, bills and savings         | [report](./p1-09-report.md) |
| P1-10 | Durable reminders and private notifications                | [report](./p1-10-report.md) |
| P1-11 | Deterministic analytics and optional XP/achievements       | [report](./p1-11-report.md) |
| P1-12 | Private export/deletion, recovery and limited sync         | [report](./p1-12-report.md) |

Final regression verification passes all 13 quality stages: 765 tests in 76 files,
all prior API baselines and architecture boundaries, 24 matching application
migration checksums in development/test, empty-schema replay and preservation of
all 63 prior table snapshots during upgrade. Compiled API/worker restart and
data export/deletion smoke pass. Phase 0 authentication, ownership, storage,
observability and controlled migration foundations remain in the regression gate.

Local tests cover cross-user/nested access, search, exports, files and sync;
recurrence/DST, historical habit schedules, weighted Goals, exact finance,
durable reminders/rewards, cursor loss/replay and explicit text conflicts.
Source Task/Goal identities remain unified, with explicit ownership and narrow
public interfaces. No Project/Team/Company, AI, client cache or general offline
engine was added. P1-12 remains uncommitted pending owner review.

Before deployment: verify Docker image/startup/volume persistence, HTTPS and host
ACL/firewall/secrets, SMTP/push channels, monitoring, coordinated encrypted
off-host backup/restore and physical 30-day expiry. Preserve the independent
current erasure namespace and validate signed backup/replay before exposing a
restored target. These are deferred production gates, not a claim of release
readiness or authorization to start another phase.
