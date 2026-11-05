import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
export async function projectExecutionCompiledSmoke(
  app: NestExpressApplication,
  pid: string,
  ownerCookie: string,
  memberCookie: string,
  member: { id: string; generation: number },
  assignmentId: string,
) {
  const base = '/api/v1/projects/' + pid,
    http = () => request(app.getHttpServer()),
    post = (path: string) =>
      http()
        .post(base + path)
        .set('Cookie', ownerCookie)
        .set('Origin', 'http://localhost:3000');
  const riskId = randomUUID();
  await post('/register-items')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: riskId,
      kind: 'RISK',
      title: 'Compiled risk',
      description: 'Explicit',
      severity: 'MEDIUM',
      probability: 25,
      owner: { accessId: member.id, generation: member.generation },
      mitigation: 'Review',
      status: 'OPEN',
    })
    .expect(200);
  const csv = await post('/change-plans/csv')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: randomUUID(),
      csv: 'title,estimatedMinutes\r\n"Compiled, CSV",45\r\n',
    })
    .expect(200);
  assert.equal(csv.body.valid, true);
  const planId = csv.body.plan.id;
  await post('/change-plans/' + planId + '/apply')
    .set('If-Match', '"1"')
    .send({ manifestHash: csv.body.plan.manifestHash })
    .expect(200);
  const taskId = csv.body.plan.operations[0].task.id,
    estimate = await http()
      .get(base + '/tasks/' + taskId + '/estimate')
      .set('Cookie', ownerCookie)
      .expect(200);
  assert.equal(estimate.body.estimatedMinutes, 45);
  await http()
    .post(base + '/tasks/' + taskId + '/work-logs')
    .set('Cookie', memberCookie)
    .set('Origin', 'http://localhost:3000')
    .set('If-Match', '"' + estimate.body.sourceRevision + '"')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: randomUUID(),
      startedAt: '2030-01-01T09:00:00Z',
      endedAt: '2030-01-01T10:00:00Z',
    })
    .expect(200);
  await post('/capacity-days')
    .send({
      id: randomUUID(),
      member: { accessId: member.id, generation: member.generation },
      date: '2030-01-01',
      timezone: 'UTC',
      availableMinutes: 60,
    })
    .expect(200);
  await post('/work-allocations')
    .send({
      id: randomUUID(),
      assignmentId,
      date: '2030-01-01',
      timezone: 'UTC',
      plannedMinutes: 90,
    })
    .expect(200);
  const workload = await http()
    .get(base + '/workload')
    .set('Cookie', ownerCookie)
    .query({ fromDate: '2030-01-01', toDate: '2030-01-02', timezone: 'UTC' })
    .expect(200);
  assert.equal(workload.body.rows[0].overbookedMinutes, 30);
  const templateId = randomUUID();
  await post('/templates')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: templateId,
      name: 'Compiled template',
      definition: {
        schemaVersion: 1,
        phases: [],
        sections: [],
        milestones: [],
        dependencies: [],
        tasks: [
          {
            key: randomUUID(),
            title: 'Fresh template Task',
            description: null,
            priority: 'NONE',
            estimatedMinutes: null,
            sectionKey: null,
            milestoneKey: null,
          },
        ],
      },
    })
    .expect(200);
  const template = await post('/templates/' + templateId + '/previews')
    .set('Idempotency-Key', randomUUID())
    .send({ id: randomUUID(), version: 1 })
    .expect(200);
  await post('/change-plans/' + template.body.id + '/apply')
    .set('If-Match', '"1"')
    .send({ manifestHash: template.body.manifestHash })
    .expect(200);
  const snapshotId = randomUUID(),
    report = await post('/reports/snapshots')
      .set('Idempotency-Key', randomUUID())
      .send({
        id: snapshotId,
        fromAt: '2030-01-01T00:00:00Z',
        toAt: '2030-01-02T00:00:00Z',
      })
      .expect(200);
  assert.equal(report.body.report.recordedSeconds, 3600);
  process.stdout.write(
    'PASS: compiled P2-06 risk history, atomic CSV/template plans, explicit shared effort, workload and immutable report snapshot.\n',
  );
  return { riskId, planId, snapshotId };
}
