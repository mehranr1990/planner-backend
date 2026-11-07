import * as c from './index.js';
import { companyPaths } from './companies-openapi.js';
export const companyKnowledgeOperations: NonNullable<
  Parameters<typeof companyPaths>[0]
> = [
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/folders',
    output: c.CompanyKnowledgeFolderSchema,
    input: c.CompanyKnowledgeFolderCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/folders',
    output: c.CompanyKnowledgeFolderPageSchema,
    query: c.CompanyKnowledgeFolderQuerySchema,
  },
  {
    method: 'patch',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/folders/{target}',
    output: c.CompanyKnowledgeFolderSchema,
    input: c.CompanyKnowledgeFolderPatchSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents',
    output: c.CompanyKnowledgeDocumentSchema,
    input: c.CompanyKnowledgeDocumentCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents',
    output: c.CompanyKnowledgeDocumentPageSchema,
    query: c.CompanyKnowledgeQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{target}',
    output: c.CompanyKnowledgeDocumentSchema,
    etag: true,
  },
  {
    method: 'patch',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{target}',
    output: c.CompanyKnowledgeDocumentSchema,
    input: c.CompanyKnowledgeDocumentPatchSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{documentId}/versions',
    output: c.CompanyKnowledgeVersionSchema,
    input: c.CompanyKnowledgeVersionCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{documentId}/versions',
    output: c.CompanyKnowledgeVersionPageSchema,
    query: c.CompanyStaffPageQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{documentId}/versions/{target}',
    output: c.CompanyKnowledgeVersionSchema,
    etag: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{documentId}/versions/{target}/publish',
    output: c.CompanyKnowledgeVersionSchema,
    input: c.CompanyKnowledgePublishSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/documents/{documentId}/versions/{target}/remove',
    output: c.CompanyKnowledgeVersionSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/knowledge/files/reconcile',
    output: c.CompanyReceiptCleanupSchema,
    input: c.CollaborationEmptySchema,
    status200: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/reports/operations',
    output: c.CompanyOperationsReportSchema,
    query: c.CompanyReportQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/reports/finance',
    output: c.CompanyFinanceReportSchema,
    query: c.CompanyReportQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/reports/portfolio',
    output: c.CompanyPortfolioReportSchema,
    query: c.CompanyReportQuerySchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/audit',
    output: c.CompanyAuditPageSchema,
    query: c.CompanyAuditQuerySchema,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/exports',
    output: c.CollaborationEmptySchema,
    input: c.CompanyExportInputSchema,
    status200: true,
  },
];
export function companyKnowledgePaths() {
  const paths = companyPaths(companyKnowledgeOperations);
  const root =
    '/companies/{id}/contexts/{scopeId}/knowledge/documents/{documentId}/versions/{target}';
  const make = (method: 'get' | 'post', path: string) =>
    companyPaths([
      {
        method,
        path,
        output: c.CompanyKnowledgeVersionSchema,
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
    description: 'Authorized private Company knowledge file',
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
  const output = paths[
    '/api/v1/companies/{id}/contexts/{scopeId}/exports'
  ] as Record<string, Record<string, unknown>>;
  const exportResponses = output.post!.responses as Record<string, unknown>;
  exportResponses['200'] = {
    description: 'Authorized bounded inline Company export',
    headers: {
      'Cache-Control': {
        schema: { type: 'string', const: 'private, no-store' },
      },
      'Content-Disposition': { schema: { type: 'string' } },
    },
    content: {
      'application/json': { schema: { type: 'object' } },
      'text/csv': { schema: { type: 'string' } },
    },
  };
  return paths;
}
