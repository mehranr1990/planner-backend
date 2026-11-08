import * as c from './index.js';
import { companyPaths } from './companies-openapi.js';
export const companyAssociationOperations: NonNullable<
  Parameters<typeof companyPaths>[0]
> = [
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/associations',
    output: c.CompanyAssociationSchema,
    input: c.CompanyAssociationCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/associations',
    query: c.CompanyAssociationQuerySchema,
    output: c.CompanyAssociationPageSchema,
  },
  {
    method: 'get',
    path: '/companies/{id}/contexts/{scopeId}/attachments',
    query: c.CompanyAssociationQuerySchema,
    output: c.CompanyAssociationPageSchema,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/accept',
    input: c.CollaborationEmptySchema,
    output: c.CompanyAssociationSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/attachment-requests',
    input: c.CollaborationEmptySchema,
    output: c.CompanyAssociationSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/attachment-requests/accept',
    input: c.CollaborationEmptySchema,
    output: c.CompanyAssociationSchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    method: 'post',
    path: '/companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/revoke',
    input: c.CompanyAssociationActionSchema,
    output: c.CompanyAssociationSchema,
    revision: true,
    etag: true,
    status200: true,
  },
];
companyAssociationOperations.push({
  method: 'post',
  path: '/companies/{id}/contexts/{scopeId}/associations/{kind}/{target}/detach',
  input: c.CompanyAssociationActionSchema,
  output: c.CompanyAssociationSchema,
  revision: true,
  etag: true,
  status200: true,
});
export function companyAssociationPaths() {
  const paths = companyPaths(companyAssociationOperations);
  for (const ops of Object.values(paths))
    for (const raw of Object.values(ops)) {
      const op = raw as { parameters: { name: string; schema: unknown }[] };
      for (const p of op.parameters)
        if (p.name === 'kind')
          p.schema = { type: 'string', enum: ['PROJECT', 'TEAM'] };
    }
  return paths;
}
