import { describe, expect, it } from 'vitest';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import type { Express } from 'express';
import { applyTrustedProxies, parseTrustedProxies } from './environment.js';

function server(trusted: string) {
  const app = new ExpressAdapter().getInstance<Express>();
  applyTrustedProxies(app, trusted);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}
const ip = async (trusted: string, forwarded?: string) => {
  const call = request(server(trusted)).get('/ip');
  if (forwarded) call.set('X-Forwarded-For', forwarded);
  return (await call.expect(200)).body.ip as string;
};

describe('trusted reverse proxies', () => {
  it('accepts only explicit IP or CIDR hops', () => {
    expect(parseTrustedProxies('')).toEqual([]);
    expect(
      parseTrustedProxies(' 172.30.240.10, 10.0.0.0/8 ,fd00::/64'),
    ).toEqual(['172.30.240.10', '10.0.0.0/8', 'fd00::/64']);
    for (const unsafe of [
      'true',
      '1',
      'loopback',
      'uniquelocal',
      '0.0.0.0/0',
      '::/0',
      '10.0.0.0/33',
      '10.0.0.0/8/1',
      '10.0.0.0/x',
      'proxy.internal',
    ])
      expect(() => parseTrustedProxies(unsafe)).toThrow(
        'TRUSTED_PROXY_ADDRESSES',
      );
  });

  it('ignores forwarded headers unless the connecting peer is trusted', async () => {
    expect(await ip('', '198.51.100.7')).toMatch(/127\.0\.0\.1$/);
    expect(await ip('10.9.9.9', '198.51.100.7')).toMatch(/127\.0\.0\.1$/);
  });

  it('uses the address appended by the trusted hop, never a spoofed prefix', async () => {
    expect(await ip('127.0.0.1', '198.51.100.7')).toBe('198.51.100.7');
    expect(await ip('127.0.0.1', '203.0.113.9, 198.51.100.7')).toBe(
      '198.51.100.7',
    );
  });
});
