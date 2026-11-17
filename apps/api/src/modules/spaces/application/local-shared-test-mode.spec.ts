import 'reflect-metadata';
import { expect, it } from 'vitest';
import { parseEnvironment } from '../../../bootstrap/environment.js';
import { PrivacyGate } from '../../../platform/authorization/privacy-gate.js';
import { SharedKernel } from './shared-kernel.service.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/mehran_dev',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
  SHARED_CONTROL_ACTIVE_KEY_ID: 'dedicated-control-key',
};
function kernel(extra: NodeJS.ProcessEnv = {}, privacy = new PrivacyGate()) {
  const config = parseEnvironment({ ...base, ...extra });
  // No persistence method is used by the activation precondition.
  const dependencies = [
    {},
    config,
    {},
    {},
    privacy,
    {},
    {},
  ] as unknown as ConstructorParameters<typeof SharedKernel>;
  return new SharedKernel(...dependencies);
}
it('waives only the acceptance reference in explicit local mode', () => {
  expect(() => kernel().assertEnabled()).toThrow();
  expect(() =>
    kernel({ SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'true' }).assertEnabled(),
  ).not.toThrow();
  expect(() =>
    kernel({
      SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'true',
      SHARED_CONTROL_ACTIVE_KEY_ID: undefined,
    }).assertEnabled(),
  ).toThrow();
  expect(() =>
    kernel({
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'actual-normal-acceptance',
    }).assertEnabled(),
  ).not.toThrow();
});
it('retains restore quarantine even with local mode and control signing configured', () => {
  const privacy = new PrivacyGate();
  privacy.quarantine();
  expect(() =>
    kernel(
      { SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'true' },
      privacy,
    ).assertEnabled(),
  ).toThrow();
});
