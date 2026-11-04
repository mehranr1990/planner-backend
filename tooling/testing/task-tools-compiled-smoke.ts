import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
export async function taskToolsCompiledSmoke(
  app: NestExpressApplication,
  pid: string,
  ownerCookie: string,
  memberCookie: string,
  member: { id: string; generation: number },
) {
  const base = '/api/v1/projects/' + pid,
    http = () => request(app.getHttpServer());
  const post = (path: string) =>
    http()
      .post(base + path)
      .set('Cookie', ownerCookie)
      .set('Origin', 'http://localhost:3000');
  const put = (path: string) =>
    http()
      .put(base + path)
      .set('Cookie', ownerCookie)
      .set('Origin', 'http://localhost:3000');
  const taskId = randomUUID(),
    successorId = randomUUID(),
    fieldId = randomUUID(),
    workflowId = randomUUID(),
    start = randomUUID(),
    end = randomUUID(),
    edge = randomUUID();
  for (const id of [taskId, successorId])
    await post('/tasks')
      .set('Idempotency-Key', randomUUID())
      .send({ id, title: 'Compiled P205' })
      .expect(201);
  await post('/custom-fields')
    .set('Idempotency-Key', randomUUID())
    .send({ id: fieldId, name: 'Score', kind: 'NUMBER', defaultValue: '12.25' })
    .expect(200);
  const field = await put('/tasks/' + taskId + '/field-values/' + fieldId)
    .set('If-Match', '"1"')
    .send({ version: 1, useDefault: true })
    .expect(200);
  assert.equal(field.body.items[0].value, '12.25');
  await post('/workflows')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: workflowId,
      name: 'Review',
      states: [
        { id: start, label: 'Todo', status: 'OPEN' },
        { id: end, label: 'Done', status: 'DONE' },
      ],
      edges: [
        {
          id: edge,
          fromStateId: start,
          toStateId: end,
          requiresApproval: true,
          approvers: [{ accessId: member.id, generation: member.generation }],
        },
      ],
    })
    .expect(200);
  await put('/tasks/' + taskId + '/workflow')
    .set('If-Match', '"2"')
    .send({ workflowId, version: 1, stateId: start })
    .expect(200);
  const pending = await post('/tasks/' + taskId + '/workflow/transitions')
    .set('If-Match', '"3"')
    .set('Idempotency-Key', randomUUID())
    .send({ edgeId: edge })
    .expect(200);
  const approved = await http()
    .post(
      base +
        '/tasks/' +
        taskId +
        '/workflow/approvals/' +
        pending.body.approval.id +
        '/approve',
    )
    .set('Cookie', memberCookie)
    .set('Origin', 'http://localhost:3000')
    .set('If-Match', '"1"')
    .send({})
    .expect(200);
  assert.equal(approved.body.task.status, 'DONE');
  const scheduled = (h: number) => ({
    plannedStartAt: `2030-01-01T${h}:00:00Z`,
    dueAt: `2030-01-01T${h + 1}:00:00Z`,
    scheduledDate: null,
  });
  await put('/tasks/' + taskId + '/schedule')
    .set('If-Match', '"4"')
    .send(scheduled(10))
    .expect(200);
  await put('/tasks/' + successorId + '/schedule')
    .set('If-Match', '"1"')
    .send(scheduled(11))
    .expect(200);
  await post('/dependencies')
    .send({
      id: randomUUID(),
      predecessorId: taskId,
      successorId,
      kind: 'FS',
      lagMinutes: 0,
    })
    .expect(200);
  const preview = await post('/reschedule-previews')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: randomUUID(),
      taskId,
      sourceRevision: 6,
      schedule: scheduled(13),
    })
    .expect(200);
  assert.equal(
    preview.body.items.filter((i: { changed: boolean }) => i.changed).length,
    2,
  );
  await post('/reschedule-previews/' + preview.body.id + '/apply')
    .set('If-Match', '"1"')
    .send({ manifestHash: preview.body.manifestHash })
    .expect(200);
  const search = await post('/task-search')
    .send({ fieldId, version: 1, operator: 'GTE', value: '12', limit: 10 })
    .expect(200);
  assert.deepEqual(
    search.body.items.map((i: { id: string }) => i.id),
    [taskId],
  );
  process.stdout.write(
    'PASS: compiled P2-05 workflow approval, typed field/default/indexed search and explicit dependency reschedule apply.\n',
  );
  return { taskId, previewId: preview.body.id as string };
}
