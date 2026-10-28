import { z } from 'zod';
import * as w from './writing.js';
import * as v from './voice-files.js';
import { PlanningDateSchema } from './planning.js';
import { FileDownloadQuerySchema } from './files.js';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
export function writingPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  function add(
    path: string,
    method: string,
    output: z.ZodType | null,
    options: {
      input?: z.ZodType;
      query?: z.ZodObject;
      revision?: boolean;
      create?: boolean;
      key?: boolean;
      etag?: boolean;
      description: string;
    },
  ) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(
      (match) => ({
        in: 'path',
        name: match[1],
        required: true,
        schema: json(match[1] === 'date' ? PlanningDateSchema : TaskIdSchema),
      }),
    );
    if (method !== 'get')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    if (options.revision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: true,
        schema: json(IfMatchSchema),
      });
    if (options.key)
      parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          pattern: '^[!-~]+$',
        },
      });
    for (const [name, schema] of Object.entries(options.query?.shape ?? {}))
      parameters.push({
        in: 'query',
        name,
        required: !schema.isOptional(),
        schema: json(schema),
      });
    const responses: Record<string, unknown> = {};
    for (const status of [400, 401, 403, 404, 409, 429, 503])
      responses[status] = {
        description:
          'Standard safe error; missing/foreign resources are 404; stale revisions are 409.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    responses[
      options.create
        ? 201
        : output || (path.endsWith('/download') && method === 'get')
          ? 200
          : 204
    ] = {
      description: 'Success',
      ...(output
        ? { content: { 'application/json': { schema: json(output) } } }
        : {}),
      ...(options.etag
        ? {
            headers: {
              ETag: {
                description:
                  'Quoted owning aggregate or logical entry revision.',
                schema: json(IfMatchSchema),
              },
            },
          }
        : {}),
    };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: 'writing_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['writing'],
      security: [{ sessionCookie: [] }],
      parameters,
      description: options.description,
      ...(method !== 'get'
        ? {
            requestBody: {
              required: !!options.input,
              content: {
                'application/json': {
                  schema: options.input
                    ? json(options.input)
                    : { type: 'object', additionalProperties: false },
                },
              },
            },
          }
        : {}),
      responses,
    };
  }

  const owner =
    'Verified personal owner; strict inputs; foreign resources/nested IDs/filters are safe404. No personal text, mood values or search queries in logs/audit/outbox. ';
  add('/notes', 'post', w.NoteSchema, {
    input: w.NoteCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Create a version1 restricted Markdown note; max50000 characters/100000 UTF8 bytes, within the existing128KB request cap. Inert JSON, no HTML rendering. Optional scoped folder/Task/Goal references are annotations, not source writes.',
  });
  add('/notes', 'get', w.NotePageSchema, {
    query: w.NoteQuerySchema,
    description:
      owner +
      'Current revision list, ACTIVE by default, stable creation/logical-ID cursor; explicit state/folder/Task/Goal filters.',
  });
  add('/notes/{id}', 'get', w.NoteSchema, {
    query: w.NoteReadQuerySchema,
    etag: true,
    description:
      owner + 'Read current Note; DELETED requires includeDeleted=true.',
  });
  add('/notes/{id}', 'patch', w.NoteSchema, {
    input: w.NotePatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Append typed immutable content/organization/state revision. Explicit ACTIVE can restore a deleted Note; history remains. New folder assignments need ACTIVE folders.',
  });
  add('/notes/{id}', 'delete', w.NoteSchema, {
    revision: true,
    etag: true,
    description:
      owner + 'Append DELETED revision without erasing content/history.',
  });
  add('/notes/{id}/history', 'get', w.NotePageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Authorized immutable revision history, including retained deletion, ordered by revision.',
  });
  add('/notes/folders', 'post', w.NoteFolderSchema, {
    input: w.NoteFolderCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Create same-space acyclic max5-level folder graph, max1000folders. Explicit position metadata.',
  });
  add('/notes/folders', 'get', w.NoteFolderPageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Creation/UUID cursor order including retained archives; position exposes explicit organization order.',
  });
  add('/notes/folders/{id}', 'get', w.NoteFolderSchema, {
    etag: true,
    description: owner + 'Read owned folder.',
  });
  add('/notes/folders/{id}', 'patch', w.NoteFolderSchema, {
    input: w.NoteFolderPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Revision-checked rename/reparent/position/status update; validates moved descendants and same-space graph.',
  });
  add('/notes/folders/{id}', 'delete', w.NoteFolderSchema, {
    revision: true,
    etag: true,
    description:
      owner + 'Archive folder; never erase child folders or Note content.',
  });
  add('/journal/entries', 'post', w.JournalEntrySchema, {
    input: w.JournalCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Create FREEFORM entry. Explicit/saved local date and IANA timezone, immutable server timestamp. Defaults from account at creation; historical attribution allowed, future dates rejected.',
  });
  add('/journal/entries', 'get', w.JournalPageSchema, {
    query: w.JournalQuerySchema,
    description:
      owner +
      'Private current journal list, optional kind and bounded366-date from/to range, deleted=false default.',
  });
  add('/journal/entries/{id}', 'get', w.JournalEntrySchema, {
    query: w.NoteReadQuerySchema,
    etag: true,
    description:
      owner +
      'Private entry; saved date/zone never change after account travel. Deleted current entries require includeDeleted=true.',
  });
  add('/journal/entries/{id}', 'patch', w.JournalEntrySchema, {
    input: w.JournalPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Append reflection/title/deletion correction; cannot reattribute date/timezone or overwrite prior values.',
  });
  add('/journal/entries/{id}', 'delete', w.JournalEntrySchema, {
    revision: true,
    etag: true,
    description: owner + 'Append deleted marker retaining private history.',
  });
  add('/journal/entries/{id}/history', 'get', w.JournalPageSchema, {
    query: CursorQuerySchema,
    description: owner + 'Private typed revision history.',
  });
  add('/journal/daily-checkins', 'post', w.DailyCheckinSchema, {
    input: w.DailyCheckinCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'At most one current nondeleted CHECK_IN per space/local date; optional subjective mood/energy is created atomically without duplicating reflection text. Wrapper revision is Journal revision.',
  });
  add('/journal/daily-checkins', 'get', w.JournalPageSchema, {
    query: w.CheckinQuerySchema,
    description:
      owner + 'Private CHECK_IN list with saved day context and bounded dates.',
  });
  add('/journal/daily-checkins/{date}', 'get', w.DailyCheckinSchema, {
    etag: true,
    description:
      owner +
      'Read original attributed ISO day and associated current nonvoid mood; account timezone changes do not reinterpret the key.',
  });
  add('/moods', 'post', w.MoodEntrySchema, {
    input: w.MoodCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Subjective mood1-5, optional energy1-5/private note; multiple entries/day. Optional Journal reference requires same recorded date/zone and at most one current associated mood. No clinical assessment or analytics.',
  });
  add('/moods', 'get', w.MoodPageSchema, {
    query: w.MoodQuerySchema,
    description:
      owner +
      'Private scoped current values, optional date/journal/score filters; no generic analytics exposure.',
  });
  add('/moods/{id}', 'get', w.MoodEntrySchema, {
    etag: true,
    description:
      owner +
      'Read current private mood revision and captured temporal context.',
  });
  add('/moods/{id}', 'patch', w.MoodEntrySchema, {
    input: w.MoodPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Append correction/VOID without changing day/zone/journal association or historical values.',
  });
  add('/moods/{id}', 'delete', w.MoodEntrySchema, {
    revision: true,
    etag: true,
    description:
      owner + 'Append VOID, never erase private historical observations.',
  });
  add('/moods/{id}/history', 'get', w.MoodPageSchema, {
    query: CursorQuerySchema,
    description:
      owner + 'Private typed observation history ordered by revision.',
  });
  add('/capture', 'post', w.CaptureSchema, {
    input: w.CaptureCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Brain Dump/Inbox uses explicit type. Voice memo is owned READY audio/wav StoredFile reference, not transcription. Expense is a retained draft, never P1-09 posting.',
  });
  add('/capture', 'get', w.CapturePageSchema, {
    query: w.CaptureQuerySchema,
    description:
      owner +
      'Scoped cursor inbox, optional state/type; raw source survives conversion.',
  });
  add('/capture/{id}', 'get', w.CaptureSchema, {
    etag: true,
    description:
      owner +
      'Source UUID/text/private voice reference and typed conversion target IDs remain traceable.',
  });
  add('/capture/{id}', 'patch', w.CaptureSchema, {
    input: w.CapturePatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Revision-checked INBOX edit/archive; archive:false explicitly restores an archived draft. TRIAGED source/target is immutable.',
  });
  add('/capture/{id}/triage', 'post', w.CaptureSchema, {
    input: w.CaptureTriageSchema,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Explicit Task/Note/Journal/Habit conversion or archive. Owner commands, target/source state, receipt, audit and capture.triaged empty-payload event commit atomically; failures roll back, retries cannot duplicate targets. Different second conversion fails409. Never infer target from text.',
  });
  add('/capture/parse', 'post', w.CaptureParseResultSchema, {
    input: w.CaptureParseSchema,
    description:
      owner +
      'Read-only deterministic version1 suggestion preview for trailing English today/tomorrow/on YYYY-MM-DD in explicit/account timezone. Unknown phrases unchanged. No classification, persistence, AI, external NLP, due-date writes or automatic application.',
  });
  add('/search/personal', 'get', w.PersonalSearchPageSchema, {
    query: w.PersonalSearchQuerySchema,
    description:
      owner +
      'Literal case-insensitive bounded text search through owner read facades. Default Notes/Tasks/Goals/INBOX Capture only; Journal/Mood providers are not called without explicit per-request includeJournal/includeMood=true. Private types without opt-in rejected. Stable scope/query/source-bound creation/UUID/kind cursor, max100/page, safe bounded snippets; no count or analytics leakage.',
  });
  add('/files/voice/uploads', 'post', v.VoiceStoredFileSchema, {
    input: v.VoiceFileUploadSchema,
    key: true,
    create: true,
    description:
      owner +
      'ADR0015 separate voice contract: canonical16-bit PCM WAV, mono/stereo,8000-96000Hz, <=10MiB and configured limit. Old four-MIME file contracts unchanged.',
  });
  add('/files/voice/{id}/complete', 'post', v.VoiceStoredFileSchema, {
    description:
      owner +
      'Upload application/octet-stream bytes, or JSON{} for READY replay. Actual signature/PCM/RIFF/data lengths, size/hash, cancellation and cleanup validated. Nonvoice IDs rejected. Uses existing private StoragePort.',
  });
  add('/files/voice/{id}/download', 'get', null, {
    query: FileDownloadQuerySchema,
    description:
      owner +
      'Expiring owner-bound signed query plus authenticated session. application/octet-stream attachment with sandbox/no-store; never static/public/inline.',
  });
  add('/files/voice/{id}', 'delete', null, {
    description:
      owner +
      'Delete private voice bytes through existing cancellation/cleanup protocol; source Capture retains FK metadata and cannot expose bytes after deletion.',
  });

  const complete = paths['/api/v1/files/voice/{id}/complete']!.post as Record<
    string,
    unknown
  >;
  complete.requestBody = {
    required: true,
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
      'application/json': {
        schema: { type: 'object', additionalProperties: false },
      },
    },
  };
  const download = paths['/api/v1/files/voice/{id}/download']!.get as Record<
    string,
    unknown
  >;
  (download.responses as Record<string, unknown>)['200'] = {
    description: 'Authenticated private attachment stream',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  };
  return paths;
}
