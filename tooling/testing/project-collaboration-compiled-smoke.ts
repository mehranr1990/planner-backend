import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
export async function projectCollaborationCompiledSmoke(
  app: NestExpressApplication,
  pid: string,
  cookie: string,
) {
  const base = '/api/v1/projects/' + pid,
    http = () => request(app.getHttpServer()),
    post = (route: string) =>
      http()
        .post(base + route)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000');
  const documentId = randomUUID();
  await post('/documents')
    .set('Idempotency-Key', randomUUID())
    .send({ id: documentId, title: 'Compiled document', body: 'Version one' })
    .expect(200);
  await http()
    .put(base + '/documents/' + documentId)
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .set('If-Match', '"1"')
    .send({ title: 'Compiled document', body: 'Version two' })
    .expect(200);
  const comment = await post('/comments')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: randomUUID(),
      target: { kind: 'DOCUMENT', id: documentId },
      body: 'Compiled comment',
    })
    .expect(200);
  const file = await post('/files')
    .set('Idempotency-Key', randomUUID())
    .send({
      id: randomUUID(),
      target: { kind: 'DOCUMENT', id: documentId },
      filename: 'compiled.txt',
      mimeType: 'text/plain',
      expectedSize: 5,
    })
    .expect(200);
  const fileRoute =
    base + '/content/DOCUMENT/' + documentId + '/files/' + file.body.id;
  await http()
    .post(fileRoute + '/complete')
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from('hello'))
    .expect(200);
  await http()
    .post(fileRoute + '/complete')
    .set('Cookie', cookie)
    .set('Origin', 'http://localhost:3000')
    .send({})
    .expect(200);
  const exported = await post('/exports').send({ format: 'JSON' }).expect(200);
  assert.equal(exported.body.documents[0].body, 'Version two');
  assert.ok(!JSON.stringify(exported.body).includes('objectKey'));
  for (const kind of [
    'LIST',
    'KANBAN',
    'CALENDAR',
    'TIMELINE',
    'GANTT',
    'DASHBOARD',
  ])
    await http()
      .get(base + '/views')
      .query({ kind, from: '2030-01-01', to: '2030-01-03', timezone: 'UTC' })
      .set('Cookie', cookie)
      .expect(200);
  process.stdout.write(
    'PASS: compiled P2-07 document versions, typed comments, private binary file/retry, six views and scoped export.\n',
  );
  return { documentId, commentId: comment.body.id, fileId: file.body.id };
}
export async function verifyProjectCollaborationRestart(
  app: NestExpressApplication,
  pid: string,
  cookie: string,
  state: { documentId: string; commentId: string; fileId: string },
) {
  const http = () => request(app.getHttpServer()),
    base = '/api/v1/projects/' + pid;
  const doc = await http()
    .get(base + '/documents/' + state.documentId)
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(doc.body.body, 'Version two');
  const versions = await http()
    .get(base + '/documents/' + state.documentId + '/versions')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(versions.body.items.length, 2);
  const comments = await http()
    .get(base + '/content/DOCUMENT/' + state.documentId + '/comments')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(comments.body.items[0].id, state.commentId);
  const download = await http()
    .get(
      base +
        '/content/DOCUMENT/' +
        state.documentId +
        '/files/' +
        state.fileId +
        '/download',
    )
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(Buffer.from(download.body).toString(), 'hello');
  process.stdout.write(
    'PASS: P2-07 current document/history, comments and private bytes survive compiled API restart and fresh worker bootstrap.\n',
  );
}
