import * as c from './index.js';
import { companyPaths } from './companies-openapi.js';
export const companyFinanceOperations: NonNullable<
  Parameters<typeof companyPaths>[0]
> = [
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/categories',
    output: c.CompanyExpenseCategorySchema,
    input: c.CompanyExpenseCategoryCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/finance/categories',
    output: c.CompanyExpenseCategoryPageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'patch',
    path: '/companies/{id}/contexts/{scopeId}/finance/categories/{target}',
    output: c.CompanyExpenseCategorySchema,
    input: c.CompanyExpenseCategoryPatchSchema,
    revision: true,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/project-references',
    output: c.CompanyFinanceProjectSchema,
    input: c.CompanyFinanceProjectCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/finance/project-references',
    output: c.CompanyFinanceProjectPageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets',
    output: c.CompanyBudgetSchema,
    input: c.CompanyBudgetCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets',
    output: c.CompanyBudgetPageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets/{target}',
    output: c.CompanyBudgetSchema,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets/{target}/adjustments',
    output: c.CompanyBudgetSchema,
    input: c.CompanyBudgetChangeSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'patch',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets/{target}/archive',
    output: c.CompanyBudgetSchema,
    input: c.CompanyBudgetArchiveSchema,
    revision: true,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets/{budgetId}/commitments',
    output: c.CompanyCommitmentSchema,
    input: c.CompanyCommitmentCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/finance/budgets/{budgetId}/commitments',
    output: c.CompanyCommitmentPageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/commitments/{target}/release',
    output: c.CompanyCommitmentSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses',
    output: c.CompanyExpenseSchema,
    input: c.CompanyExpenseCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/expenses',
    output: c.CompanyExpensePageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}',
    output: c.CompanyExpenseSchema,
    etag: true,
  },
  {
    method: 'patch',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}',
    output: c.CompanyExpenseSchema,
    input: c.CompanyExpenseFactsSchema,
    revision: true,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/submit',
    output: c.CompanyExpenseSchema,
    input: c.CompanyExpenseSubmitSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'put',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/reviewer',
    output: c.CompanyExpenseSchema,
    input: c.CompanyExpenseSubmitSchema,
    revision: true,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/decision',
    output: c.CompanyExpenseSchema,
    input: c.CompanyExpenseDecisionSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/cancel',
    output: c.CompanyExpenseSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/corrections',
    output: c.CompanyExpenseSchema,
    input: c.CompanyExpenseFactsSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/reversals',
    output: c.CompanyExpenseSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{target}/revisions',
    output: c.CompanyExpenseRevisionPageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{expenseId}/revisions/{versionId}/receipts',
    output: c.CompanyExpenseReceiptSchema,
    input: c.CompanyExpenseReceiptCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{expenseId}/revisions/{versionId}/receipts',
    output: c.CompanyExpenseReceiptPageSchema,
    query: c.CompanyFinancePageQuerySchema,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/expenses/{expenseId}/revisions/{versionId}/receipts/{receiptId}/remove',
    output: c.CompanyExpenseReceiptSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/finance/receipts/reconcile',
    output: c.CompanyReceiptCleanupSchema,
    input: c.CollaborationEmptySchema,
    status200: true,
  },
];
export function companyFinancePaths() {
  const paths = companyPaths(companyFinanceOperations);
  const root =
    '/companies/{id}/contexts/{scopeId}/expenses/{expenseId}/revisions/{versionId}/receipts/{receiptId}';
  const make = (method: 'get' | 'post', path: string) =>
    companyPaths([
      {
        method,
        path,
        output: c.CompanyExpenseReceiptSchema,
        ...(method === 'post'
          ? {
              input: c.CollaborationEmptySchema,
              revision: true,
              etag: true,
              status200: true,
            }
          : {}),
      },
    ])['/api/v1' + path]!;
  paths['/api/v1' + root + '/complete'] = make('post', root + '/complete');
  const complete = paths['/api/v1' + root + '/complete'] as Record<
    string,
    Record<string, unknown>
  >;
  complete.post!.requestBody = {
    required: true,
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  };
  paths['/api/v1' + root + '/download'] = make('get', root + '/download');
  const download = paths['/api/v1' + root + '/download'] as Record<
    string,
    Record<string, unknown>
  >;
  const responses = download.get!.responses as Record<string, unknown>;
  responses['200'] = {
    description: 'Authorized private expense receipt',
    headers: {
      'Cache-Control': {
        schema: { type: 'string', const: 'private, no-store' },
      },
      'Content-Disposition': { schema: { type: 'string' } },
      'X-Content-Type-Options': {
        schema: { type: 'string', const: 'nosniff' },
      },
    },
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  };
  return paths;
}
