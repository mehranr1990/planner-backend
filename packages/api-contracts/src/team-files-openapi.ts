import * as c from './index.js';
import { ProjectPageQuerySchema } from './projects.js';
import { teamCompletionPaths } from './team-completion-openapi.js';
import type { Operation } from './team-completion-openapi.js';
const team = '/teams/{id}',
  version = team + '/files/{fileId}/versions/{versionId}';
export const teamFileOperations: Operation[] = [
  {
    path: team + '/file-folders',
    method: 'get',
    output: c.TeamFileFolderPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/file-folders',
    method: 'post',
    output: c.TeamFileFolderSchema,
    input: c.TeamFileFolderCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: team + '/file-folders/{folderId}',
    method: 'patch',
    output: c.TeamFileFolderSchema,
    input: c.TeamFileFolderPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: team + '/file-folders/{folderId}/remove',
    method: 'post',
    output: c.TeamFileRemovedSchema,
    input: c.BackendCompletionEmptySchema,
    revision: true,
    status: 200,
  },
  {
    path: team + '/files',
    method: 'get',
    output: c.TeamFilePageSchema,
    query: c.TeamFileQuerySchema,
  },
  {
    path: team + '/files',
    method: 'post',
    output: c.TeamFileSchema,
    input: c.TeamFileCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: team + '/files/{fileId}',
    method: 'get',
    output: c.TeamFileSchema,
    etag: true,
  },
  {
    path: team + '/files/{fileId}',
    method: 'patch',
    output: c.TeamFileSchema,
    input: c.TeamFilePatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: team + '/files/{fileId}/remove',
    method: 'post',
    output: c.TeamFileSchema,
    input: c.BackendCompletionEmptySchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: team + '/files/{fileId}/versions',
    method: 'get',
    output: c.TeamFileVersionPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: team + '/files/{fileId}/versions',
    method: 'post',
    output: c.TeamFileVersionSchema,
    input: c.TeamFileVersionCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: version + '/complete',
    method: 'post',
    output: c.TeamFileVersionSchema,
    input: c.BackendCompletionEmptySchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: version + '/download',
    method: 'get',
    output: c.TeamFileVersionSchema,
  },
];
const binary = {
  'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
};
export function teamFilePaths() {
  const paths = teamCompletionPaths(teamFileOperations, {
    prefix: 'teamFiles',
    tag: 'team-files',
    description: 'Current authorized Team file library result',
  });
  const complete = paths['/api/v1' + version + '/complete'] as Record<
    string,
    Record<string, unknown>
  >;
  complete.post!.requestBody = { required: true, content: binary };
  const download = paths['/api/v1' + version + '/download'] as Record<
    string,
    Record<string, unknown>
  >;
  (download.get!.responses as Record<string, unknown>)['200'] = {
    description: 'Authorized private Team file bytes',
    headers: {
      'Cache-Control': {
        schema: { type: 'string', const: 'private, no-store' },
      },
      'Content-Disposition': { schema: { type: 'string' } },
      'X-Content-Type-Options': {
        schema: { type: 'string', const: 'nosniff' },
      },
    },
    content: binary,
  };
  return paths;
}
