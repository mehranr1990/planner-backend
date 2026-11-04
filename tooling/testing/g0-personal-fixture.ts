import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';

/** Synthetic P1 data only; never copies configured users or private file bytes. */
export async function seedG0Personal(client: Client) {
  const insert = async (table: string, values: Record<string, unknown>) => {
    const keys = Object.keys(values);
    await client.query(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
      Object.values(values),
    );
  };
  const user = randomUUID(),
    other = randomUUID(),
    space = randomUUID(),
    closed = randomUUID();
  const now = new Date('2026-10-30T00:00:00Z');
  for (const [id, email] of [
    [user, 'g0@example.test'],
    [other, 'g0-other@example.test'],
  ]) {
    await insert('User', {
      id,
      name: 'Synthetic G0',
      email,
      emailVerified: true,
      updatedAt: now,
    });
    await insert('AuthAccount', {
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: 'synthetic-not-a-real-credential',
      updatedAt: now,
    });
    await insert('AuthSession', {
      id: randomUUID(),
      userId: id,
      token: randomUUID(),
      expiresAt: new Date('2027-01-01Z'),
      updatedAt: now,
    });
    await insert('UserSettings', {
      userId: id,
      locale: 'fa',
      timezone: 'Asia/Tehran',
      preferredCalendar: 'JALALI',
      firstDayOfWeek: 6,
      revision: 7,
      updatedAt: now,
    });
  }
  await insert('AuthVerification', {
    id: randomUUID(),
    identifier: 'synthetic@example.test',
    value: 'synthetic-fixture',
    expiresAt: new Date('2027-01-01Z'),
    updatedAt: now,
  });
  await insert('Space', {
    id: space,
    ownerUserId: user,
    updatedAt: now,
    syncSequence: 1,
  });
  await insert('Space', {
    id: closed,
    ownerUserId: other,
    updatedAt: now,
    accessClosedAt: now,
  });
  const task = randomUUID(),
    child = randomUUID(),
    master = randomUUID();
  for (const id of [task, child, master])
    await insert('Task', {
      id,
      spaceId: space,
      createdByUserId: user,
      title: 'Synthetic retained Task',
      revision: 3,
      updatedAt: now,
      ...(id === child ? { parentTaskId: task } : {}),
    });
  await insert('Task', {
    id: randomUUID(),
    spaceId: closed,
    createdByUserId: other,
    title: 'Other owner preserved',
    updatedAt: now,
  });
  await insert('TaskChecklistItem', {
    id: randomUUID(),
    spaceId: space,
    taskId: task,
    title: 'Retained checklist',
    position: 0,
    updatedAt: now,
  });
  const label = randomUUID();
  await insert('Label', {
    id: label,
    spaceId: space,
    name: 'Retained label',
    updatedAt: now,
  });
  await insert('TaskLabel', { spaceId: space, taskId: task, labelId: label });
  await insert('TaskChange', {
    id: randomUUID(),
    spaceId: space,
    taskId: task,
    actorUserId: user,
    kind: 'CREATED',
    fields: ['title'],
    previousRevision: 0,
    revision: 1,
    afterStatus: 'OPEN',
    afterPriority: 'NONE',
  });
  const bytes = Buffer.from('fixture'),
    file = randomUUID(),
    objectKey = randomUUID();
  await insert('StoredFile', {
    id: file,
    spaceId: space,
    ownerUserId: user,
    objectKey,
    filename: 'synthetic.txt',
    mimeType: 'text/plain',
    expectedSize: bytes.length,
    actualSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    status: 'READY',
    uploadExpiresAt: new Date('2027-01-01Z'),
    updatedAt: now,
    completedAt: now,
  });
  await insert('TaskAttachment', {
    spaceId: space,
    taskId: task,
    fileId: file,
  });
  const definition = {
    version: 1,
    pattern: 'DAILY',
    interval: 1,
    weekdays: [],
    monthDay: null,
    nth: null,
    weekday: null,
    month: null,
    day: null,
    startDate: '2026-10-30',
    localTime: '09:00',
    timezone: 'Asia/Tehran',
    endDate: null,
    count: null,
    exclusions: [],
  };
  const series = randomUUID();
  await insert('TaskRecurrence', {
    id: series,
    spaceId: space,
    createdByUserId: user,
    masterTaskId: master,
    definition,
    identityTime: '09:00',
    updatedAt: now,
  });
  await insert('TaskOccurrence', {
    id: randomUUID(),
    spaceId: space,
    seriesId: series,
    taskId: task,
    recurrenceKey: '2026-10-30T09:00:00',
    localDate: '2026-10-30',
    localTime: '09:00',
    timezone: 'Asia/Tehran',
    scheduledAt: now,
    updatedAt: now,
  });
  await insert('TaskTemplate', {
    id: randomUUID(),
    spaceId: space,
    createdByUserId: user,
    name: 'Synthetic',
    values: { version: 1, title: 'Retained template' },
    updatedAt: now,
  });
  await insert('SavedTaskFilter', {
    id: randomUUID(),
    spaceId: space,
    createdByUserId: user,
    name: 'Synthetic',
    query: { version: 1, status: 'OPEN' },
    updatedAt: now,
  });
  const plan = randomUUID();
  await insert('DailyPlan', {
    id: plan,
    spaceId: space,
    createdByUserId: user,
    localDate: '2026-10-30',
    timezone: 'Asia/Tehran',
    updatedAt: now,
  });
  await insert('DailyPlanItem', {
    id: randomUUID(),
    spaceId: space,
    planId: plan,
    localDate: '2026-10-30',
    taskId: task,
    position: 0,
    selectedTaskRevision: 3,
    updatedAt: now,
  });
  await insert('WeeklyPlan', {
    id: randomUUID(),
    spaceId: space,
    createdByUserId: user,
    weekStartDate: '2026-10-24',
    timezone: 'Asia/Tehran',
    firstDayOfWeek: 6,
    updatedAt: now,
  });
  await insert('PlanningReview', {
    id: randomUUID(),
    spaceId: space,
    createdByUserId: user,
    localDate: '2026-10-30',
    kind: 'MORNING',
    timezone: 'Asia/Tehran',
    firstDayOfWeek: 6,
    reflection: 'Synthetic private reflection',
    updatedAt: now,
  });
  const goal = randomUUID(),
    metric = randomUUID();
  await insert('Goal', {
    id: goal,
    spaceId: space,
    createdByUserId: user,
    title: 'Synthetic goal',
    horizon: 'LONG_TERM',
    timezone: 'Asia/Tehran',
    updatedAt: now,
  });
  await insert('GoalMetric', {
    id: metric,
    spaceId: space,
    goalId: goal,
    title: 'Synthetic metric',
    unit: 'COUNT',
    baseline: 0,
    target: 10,
    current: 5,
    updatedAt: now,
  });
  await client.query(
    'UPDATE "Goal" SET "metricId"=$2,"progressMode"=\'METRIC\' WHERE id=$1',
    [goal, metric],
  );
  await insert('GoalTaskLink', {
    id: randomUUID(),
    spaceId: space,
    goalId: goal,
    taskId: task,
    selectedSourceRevision: 3,
    updatedAt: now,
  });
  await insert('GoalReview', {
    id: randomUUID(),
    spaceId: space,
    goalId: goal,
    kind: 'REVIEW',
    reflection: 'Synthetic private review',
    snapshot: { ruleVersion: 1 },
  });
  const folder = randomUUID(),
    note = randomUUID(),
    journal = randomUUID();
  await insert('NoteFolder', {
    id: folder,
    spaceId: space,
    createdByUserId: user,
    title: 'Synthetic folder',
    updatedAt: now,
  });
  await insert('Note', {
    id: note,
    logicalId: note,
    spaceId: space,
    createdByUserId: user,
    title: 'Synthetic note',
    content: 'Private synthetic text',
    createdAt: now,
    recordedAt: now,
    folderId: folder,
    taskId: task,
    goalId: goal,
  });
  await insert('JournalEntry', {
    id: journal,
    logicalId: journal,
    spaceId: space,
    createdByUserId: user,
    content: 'Synthetic private journal',
    createdAt: now,
    recordedAt: now,
    kind: 'CHECK_IN',
    localDate: '2026-10-30',
    timezone: 'Asia/Tehran',
  });
  const mood = randomUUID();
  await insert('MoodEntry', {
    id: mood,
    logicalId: mood,
    spaceId: space,
    createdByUserId: user,
    mood: 4,
    energy: 3,
    createdAt: now,
    recordedAt: now,
    localDate: '2026-10-30',
    timezone: 'Asia/Tehran',
    journalEntryId: journal,
  });
  const capture = randomUUID(),
    account = randomUUID(),
    transaction = randomUUID();
  await insert('CaptureItem', {
    id: capture,
    spaceId: space,
    createdByUserId: user,
    type: 'EXPENSE',
    text: 'Synthetic draft',
    updatedAt: now,
  });
  await insert('FinancialAccount', {
    id: account,
    spaceId: space,
    createdByUserId: user,
    name: 'Synthetic account',
    currency: 'USD',
    scale: 2,
    updatedAt: now,
  });
  await insert('Transaction', {
    id: transaction,
    spaceId: space,
    createdByUserId: user,
    type: 'EXPENSE',
    occurredAt: now,
    localDate: '2026-10-30',
    timezone: 'UTC',
    sourceCaptureId: capture,
    updatedAt: now,
  });
  await insert('TransactionPosting', {
    id: randomUUID(),
    spaceId: space,
    transactionId: transaction,
    accountId: account,
    currency: 'USD',
    scale: 2,
    amount: '-12.34',
    role: 'EXPENSE',
  });
  await client.query(
    'UPDATE "CaptureItem" SET state=\'TRIAGED\',"targetTransactionId"=$2 WHERE id=$1',
    [capture, transaction],
  );
  const event = randomUUID();
  await insert('OutboxEvent', {
    id: event,
    spaceId: space,
    type: 'task.completed',
    version: 1,
    aggregateId: task,
    payload: {},
    correlationId: randomUUID(),
  });
  await insert('SecurityAuditEvent', {
    id: randomUUID(),
    action: 'ACCOUNT_SETTINGS_UPDATE',
    outcome: 'SUCCEEDED',
    actorUserId: user,
    requestId: randomUUID(),
    correlationId: randomUUID(),
  });
  await insert('IdempotencyRecord', {
    id: randomUUID(),
    spaceId: space,
    actorUserId: user,
    operation: 'g0.fixture',
    keyHash: 'a'.repeat(64),
    fingerprint: 'b'.repeat(64),
    resultId: task,
    statusCode: 201,
    expiresAt: new Date('2027-01-01Z'),
  });
  await insert('SyncChange', {
    id: randomUUID(),
    spaceId: space,
    sequence: 1,
    entity: 'TASK',
    resourceId: task,
    revision: 3,
    deleted: false,
  });
  await insert('SyncMutationReceipt', {
    id: randomUUID(),
    spaceId: space,
    actorUserId: user,
    clientMutationId: randomUUID(),
    fingerprint: 'c'.repeat(64),
    disposition: 'APPLIED',
    resourceId: task,
    result: { fixture: true },
    bodyExpiresAt: new Date('2027-01-01Z'),
  });
  await insert('UserExportJob', {
    id: randomUUID(),
    spaceId: space,
    ownerUserId: user,
    objectKey: randomUUID(),
    attemptKey: randomUUID(),
  });
  await insert('AccountDeletionJob', {
    id: randomUUID(),
    spaceId: closed,
    ownerUserId: other,
    identityDigest: 'd'.repeat(64),
    spaceDigest: 'e'.repeat(64),
    policyVersion: 'SYNTHETIC_ONLY',
    retentionAcknowledged: true,
    state: 'WAITING',
    confirmedAt: now,
    eraseAfter: new Date(now.getTime() + 7 * 86400000),
  });
  return { user, other, space, closed, task, file, objectKey, bytes };
}
