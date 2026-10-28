import { z } from 'zod';
import * as c from './calendar.js';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
export function calendarPaths(): Record<string, Record<string, unknown>> {
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
      conditionalKey?: boolean;
      etag?: boolean;
      description: string;
    },
  ) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(
      (match) => ({
        in: 'path',
        name: match[1],
        required: true,
        schema: json(TaskIdSchema),
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
    if (options.key || options.conditionalKey)
      parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: options.key === true,
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
    responses[options.create ? 201 : output ? 200 : 204] = {
      description: 'Success',
      ...(output
        ? { content: { 'application/json': { schema: json(output) } } }
        : {}),
      ...(options.etag
        ? {
            headers: {
              ETag: {
                description: 'Quoted owning aggregate revision.',
                schema: json(IfMatchSchema),
              },
            },
          }
        : {}),
    };
    paths['/api/v1/calendar' + path] ??= {};
    paths['/api/v1/calendar' + path]![method] = {
      operationId: 'calendar_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['calendar'],
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
  for (const [path, create, patch, output, page] of [
    [
      '/events',
      c.CalendarEventCreateSchema,
      c.CalendarEventPatchSchema,
      c.CalendarEventSchema,
      c.CalendarEventPageSchema,
    ],
    [
      '/time-blocks',
      c.TimeBlockCreateSchema,
      c.TimeBlockPatchSchema,
      c.TimeBlockSchema,
      c.TimeBlockPageSchema,
    ],
  ] as const) {
    add(path, 'post', output, {
      input: create,
      create: true,
      key: true,
      etag: true,
      description:
        'Owner-only idempotent creation. Dates are Gregorian, timed input resolves exact wall time in the saved IANA zone. DST gap returns VALIDATION_ERROR with DST_GAP; earlier fold policy is returned. Never writes Tasks.',
    });
    add(path, 'get', page, {
      query: CursorQuerySchema,
      description:
        'Scoped cursor list of nondeleted resources, ordered by creation instant and UUID. Series masters are definitions, not additional actionable occurrences.',
    });
    add(path + '/{id}', 'get', output, {
      etag: true,
      description:
        'Owner-only resource including retained deletion metadata, timezone and explicit temporal policies.',
    });
    add(path + '/{id}', 'patch', output, {
      input: patch,
      revision: true,
      etag: true,
      description:
        'Revision-checked mutation; recurring events and exceptions use the explicit series editing endpoint. Task references require current actionable owned Tasks; existing terminal/deleted references remain traceable and detachable.',
    });
    add(path + '/{id}', 'delete', null, {
      revision: true,
      description:
        'Retains a deletion tombstone; excludes the resource from normal lists and views. Cancel individual recurring instances through series editing.',
    });
  }
  add('/events/{id}/series', 'post', c.CalendarSeriesResultSchema, {
    input: c.CalendarSeriesEditSchema,
    revision: true,
    etag: true,
    conditionalKey: true,
    description:
      'THIS_OCCURRENCE checks exceptionRevision (0 if absent) and preserves identity. THIS_AND_FUTURE requires Idempotency-Key and a recurrence starting at the selected date; creates a linked successor and preserves explicit future exceptions on the predecessor with matching successor exclusions. ENTIRE_SERIES versions unelapsed nonexception occurrences; elapsed/canceled/skipped history is immutable. Return 409 for stale revisions/history collisions. Maximum 1000 versions/exceptions per series.',
  });
  for (const [path, output] of [
    ['/views', c.CalendarViewSchema],
    ['/conflicts', c.CalendarConflictsSchema],
  ] as const)
    add(path, 'get', output, {
      query: c.CalendarRangeQuerySchema,
      description:
        'Owner-only half-open local date range, max 93 dates, explicit display timezone, max 100 entries/page. Views scan at most 25 resources/page; empty pages may carry a cursor. Resource creation/UUID then recurrence key ordering; a held resource edit invalidates its cursor. Conflicts are advisory, omit canceled/skipped entries, compare half-open intervals and bind pages to a snapshot. Conflict analysis is capped at 1000 occurrences/1000 resources and 10000 pairs; RANGE_TOO_DENSE asks for a narrower range. All-day occupancy uses requested-zone day boundaries. Overlaps are permitted. No Task or account timezone writes.',
    });
  return paths;
}
