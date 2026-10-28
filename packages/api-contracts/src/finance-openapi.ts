import { z } from 'zod';
import * as f from './finance.js';
import { CursorQuerySchema, IfMatchSchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { PlanningDateSchema } from './planning.js';
export function financePaths(): Record<string, Record<string, unknown>> {
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
    for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 503])
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
      operationId: 'finance_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['finance'],
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

  const description =
    'Verified personal owner. Exact minor-unit decimal strings; saved temporal attribution; metadata-only audit/outbox. Scoped FKs, revision conditions and atomic ledger effects. ';
  add('/finance/accounts', 'post', f.FinanceAccountSchema, {
    input: f.FinanceAccountCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description + 'Create explicitly; no automatic money movement.',
  });
  add('/finance/accounts', 'get', f.FinanceAccountPageSchema, {
    query: f.FinanceQuerySchema,
    description:
      description + 'Bounded scoped cursor list; active resources by default.',
  });
  add('/finance/accounts/{id}', 'get', f.FinanceAccountSchema, {
    etag: true,
    description,
  });
  add('/finance/accounts/{id}', 'patch', f.FinanceAccountSchema, {
    input: f.FinanceAccountPatchSchema,
    revision: true,
    etag: true,
    description:
      description +
      'No free balance overwrite, identity/currency/context/source mutation.',
  });
  add('/finance/accounts/{id}', 'delete', f.FinanceAccountSchema, {
    revision: true,
    etag: true,
    description: description + 'Archive; preserve ledger and history.',
  });
  add('/finance/categories', 'post', f.FinanceCategorySchema, {
    input: f.FinanceCategoryCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description + 'Create explicitly; no automatic money movement.',
  });
  add('/finance/categories', 'get', f.FinanceCategoryPageSchema, {
    query: f.FinanceQuerySchema,
    description:
      description + 'Bounded scoped cursor list; active resources by default.',
  });
  add('/finance/categories/{id}', 'get', f.FinanceCategorySchema, {
    etag: true,
    description,
  });
  add('/finance/categories/{id}', 'patch', f.FinanceCategorySchema, {
    input: f.FinanceCategoryPatchSchema,
    revision: true,
    etag: true,
    description:
      description +
      'No free balance overwrite, identity/currency/context/source mutation.',
  });
  add('/finance/categories/{id}', 'delete', f.FinanceCategorySchema, {
    revision: true,
    etag: true,
    description: description + 'Archive; preserve ledger and history.',
  });
  add('/finance/budgets', 'post', f.FinanceBudgetSchema, {
    input: f.FinanceBudgetCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description + 'Create explicitly; no automatic money movement.',
  });
  add('/finance/budgets', 'get', f.FinanceBudgetPageSchema, {
    query: f.FinanceQuerySchema,
    description:
      description + 'Bounded scoped cursor list; active resources by default.',
  });
  add('/finance/budgets/{id}', 'get', f.FinanceBudgetSchema, {
    etag: true,
    description,
  });
  add('/finance/budgets/{id}', 'patch', f.FinanceBudgetSchema, {
    input: f.FinanceBudgetPatchSchema,
    revision: true,
    etag: true,
    description:
      description +
      'No free balance overwrite, identity/currency/context/source mutation.',
  });
  add('/finance/budgets/{id}', 'delete', f.FinanceBudgetSchema, {
    revision: true,
    etag: true,
    description: description + 'Archive; preserve ledger and history.',
  });
  add('/finance/bills', 'post', f.FinanceBillSchema, {
    input: f.FinanceBillCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description + 'Create explicitly; no automatic money movement.',
  });
  add('/finance/bills', 'get', f.FinanceBillPageSchema, {
    query: f.FinanceQuerySchema,
    description:
      description + 'Bounded scoped cursor list; active resources by default.',
  });
  add('/finance/bills/{id}', 'get', f.FinanceBillSchema, {
    etag: true,
    description,
  });
  add('/finance/bills/{id}', 'patch', f.FinanceBillSchema, {
    input: f.FinanceBillPatchSchema,
    revision: true,
    etag: true,
    description:
      description +
      'No free balance overwrite, identity/currency/context/source mutation.',
  });
  add('/finance/bills/{id}/history', 'get', f.FinanceBillPageSchema, {
    query: CursorQuerySchema,
    description: description + 'Immutable typed revision history.',
  });
  add('/finance/savings-goals', 'post', f.FinanceSavingsSchema, {
    input: f.FinanceSavingsCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description + 'Create explicitly; no automatic money movement.',
  });
  add('/finance/savings-goals', 'get', f.FinanceSavingsPageSchema, {
    query: f.FinanceQuerySchema,
    description:
      description + 'Bounded scoped cursor list; active resources by default.',
  });
  add('/finance/savings-goals/{id}', 'get', f.FinanceSavingsSchema, {
    etag: true,
    description,
  });
  add('/finance/savings-goals/{id}', 'patch', f.FinanceSavingsSchema, {
    input: f.FinanceSavingsPatchSchema,
    revision: true,
    etag: true,
    description:
      description +
      'No free balance overwrite, identity/currency/context/source mutation.',
  });
  add('/finance/savings-goals/{id}', 'delete', f.FinanceSavingsSchema, {
    revision: true,
    etag: true,
    description: description + 'Archive; preserve ledger and history.',
  });
  add(
    '/finance/savings-goals/{id}/history',
    'get',
    f.FinanceSavingsPageSchema,
    {
      query: CursorQuerySchema,
      description: description + 'Immutable typed revision history.',
    },
  );

  add('/finance/transactions', 'post', f.FinanceTransactionSchema, {
    input: f.FinanceSingleCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description + 'Post income/expense/explicit adjustment atomically.',
  });
  add('/finance/transfers', 'post', f.FinanceTransactionSchema, {
    input: f.FinanceTransferCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      description +
      'Atomic signed source/destination legs; optional explicit fee; cross-currency requires recorded exact HALF_UP rate snapshot.',
  });
  add('/finance/transactions', 'get', f.FinanceTransactionPageSchema, {
    query: f.FinanceQuerySchema,
    description:
      description +
      'Include immutable reversal effects; date filters use original attributed localDate.',
  });
  add('/finance/transactions/{id}', 'get', f.FinanceTransactionSchema, {
    etag: true,
    description,
  });
  add(
    '/finance/transactions/{id}/history',
    'get',
    f.FinanceTransactionPageSchema,
    {
      query: CursorQuerySchema,
      description: description + 'Bounded original/reversal/replacement chain.',
    },
  );
  add(
    '/finance/transactions/{id}/reverse',
    'post',
    f.FinanceTransactionSchema,
    {
      revision: true,
      key: true,
      etag: true,
      description:
        description +
        'Append exact negated postings once; restate original attribution, retain server recording history.',
    },
  );
  add(
    '/finance/transactions/{id}/correct',
    'post',
    f.FinanceTransactionSchema,
    {
      input: f.FinanceCorrectionSchema,
      revision: true,
      key: true,
      etag: true,
      description:
        description +
        'Atomically reverse and append replacement; never rewrite posted amounts.',
    },
  );
  add(
    '/finance/transactions/from-capture',
    'post',
    f.FinanceDraftResultSchema,
    {
      input: f.FinanceCapturePostSchema,
      create: true,
      key: true,
      etag: true,
      description:
        description +
        'Explicit INBOX EXPENSE conversion through Capture owner transaction; typed source/target and unique source posting survive receipt expiry and reversal. Old Capture contracts unchanged.',
    },
  );
  add('/finance/budgets/{id}/periods', 'post', f.FinancePeriodSchema, {
    input: f.FinancePeriodCreateSchema,
    revision: true,
    key: true,
    create: true,
    etag: true,
    description:
      description +
      'Snapshot saved Gregorian/Jalali/week context and limit in explicit half-open period. Overspend is advisory.',
  });
  add('/finance/budgets/{id}/periods', 'get', f.FinancePeriodPageSchema, {
    query: CursorQuerySchema,
    description:
      description + 'Read saved periods and live exact ledger spending.',
  });
  add(
    '/finance/budgets/{id}/periods/{periodId}',
    'patch',
    f.FinancePeriodSchema,
    {
      input: f.FinancePeriodPatchSchema,
      revision: true,
      etag: true,
      description:
        description +
        'Explicit revision-checked period limit correction; no silent historical limit change.',
    },
  );
  add('/finance/bills/{id}/preview', 'get', f.FinanceBillOccurrencePageSchema, {
    query: f.FinanceBillPreviewQuerySchema,
    description:
      description +
      'Read-only date-schedule expansion, max366 dates/100 per page, saved versions and durable PAID/REVERSED identities; no automatic posting.',
  });
  add('/finance/bills/{id}/pay', 'post', f.FinanceTransactionSchema, {
    input: f.FinanceBillPostSchema,
    revision: true,
    key: true,
    etag: true,
    description:
      description +
      'Explicit unique occurrence posting or revision-checked existing payment link, atomically; reversed payments cannot silently repost.',
  });
  add('/finance/reports', 'get', f.FinanceReportSchema, {
    query: f.FinanceReportQuerySchema,
    description:
      description +
      'Max366-day view-zone window/10000 postings. Expense includes fees, excludes principal transfers/adjustments; currencies grouped without implicit conversion. Reversals restate original period.',
  });
  add(
    '/finance/export',
    'get',
    z.strictObject({
      version: z.literal(1),
      from: PlanningDateSchema,
      to: PlanningDateSchema,
      timezone: z.string(),
      transactions: z.array(f.FinanceTransactionSchema).max(10000),
    }),
    {
      query: f.FinanceExportQuerySchema,
      description:
        description +
        'Authenticated bounded streaming JSON/CSV with exact decimal strings and neutralized spreadsheet formulas; no public files.',
    },
  );
  const op = paths['/api/v1/finance/export']!['get']! as {
    responses: Record<string, { content: Record<string, unknown> }>;
  };
  op.responses['200']!.content['text/csv'] = {
    schema: { type: 'string' },
    example:
      'transactionId,type,effect,occurredAt,localDate,timezone,accountId,currency,amount,role,note',
  };
  return paths;
}
