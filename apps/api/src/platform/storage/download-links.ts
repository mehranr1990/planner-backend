import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { AppConfig } from '../../bootstrap/environment.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import type { FileDownloadQuery } from '@mehran/api-contracts';

function signature(
  config: AppConfig,
  scope: AuthorizedSpace,
  id: string,
  expires: string,
) {
  return createHmac('sha256', config.BETTER_AUTH_SECRET)
    .update(
      JSON.stringify([
        'private-file-link-v1',
        scope.actor.userId,
        scope.spaceId,
        id,
        expires,
      ]),
    )
    .digest('hex');
}
export function fileDownloadLink(
  config: AppConfig,
  scope: AuthorizedSpace,
  id: string,
) {
  const expires = String(
    Math.floor(Date.now() / 1000) + config.FILE_LINK_TTL_SECONDS,
  );
  const query = new URLSearchParams({
    expires,
    signature: signature(config, scope, id, expires),
  });
  return {
    url: `/api/v1/files/${id}/download?${query}`,
    expiresAt: new Date(Number(expires) * 1000).toISOString(),
  };
}
export function verifyFileLink(
  config: AppConfig,
  scope: AuthorizedSpace,
  id: string,
  query: FileDownloadQuery,
) {
  const expiry = Number(query.expires);
  const now = Math.floor(Date.now() / 1000);
  if (
    expiry <= now ||
    expiry > now + config.FILE_LINK_TTL_SECONDS ||
    !/^[a-f0-9]{64}$/.test(query.signature) ||
    !timingSafeEqual(
      Buffer.from(query.signature, 'hex'),
      Buffer.from(signature(config, scope, id, query.expires), 'hex'),
    )
  )
    throw new ForbiddenException();
}
