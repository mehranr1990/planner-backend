import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';

describe('configuration safety', () => {
  it('requires a strong identity secret and rejects unsafe production origins/mail configuration', () => {
    const valid = {
      DATABASE_URL: 'postgresql://localhost/mehran_dev',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
    };
    for (const override of [
      { BETTER_AUTH_SECRET: 'short' },
      {
        BETTER_AUTH_SECRET: 'REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
      },
      { CORS_ORIGINS: '*' },
      { NODE_ENV: 'production' },
      { MAIL_MODE: 'smtp' },
    ])
      expect(() => parseEnvironment({ ...valid, ...override })).toThrow(
        'Invalid configuration',
      );
    const production = parseEnvironment({
      ...valid,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.invalid',
      MAIL_MODE: 'smtp',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_USER: 'test-only',
      SMTP_PASSWORD: 'test-only',
    });
    expect(production.NODE_ENV).toBe('production');
  });
  it('requires DATABASE_URL with a useful safe error', () => {
    expect(() =>
      parseEnvironment({
        BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
        BETTER_AUTH_URL: 'http://localhost:3000',
      }),
    ).toThrow('Invalid configuration: DATABASE_URL');
  });
  it('does not disclose rejected credentials', () => {
    expect(() =>
      parseEnvironment({
        BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
        BETTER_AUTH_URL: 'http://localhost:3000',
        DATABASE_URL: 'secret-password',
        PORT: 'invalid',
      }),
    ).toThrow('Invalid configuration:');
    try {
      parseEnvironment({
        BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
        BETTER_AUTH_URL: 'http://localhost:3000',
        DATABASE_URL: 'secret-password',
      });
    } catch (error) {
      expect(String(error)).not.toContain('secret-password');
    }
  });
  it('validates numeric ranges, protocol and enum values', () => {
    for (const override of [
      { PORT: '0' },
      { DB_HEALTH_TIMEOUT_MS: '10' },
      { DATABASE_URL: 'https://example.com/db' },
      { NODE_ENV: 'staging' },
    ]) {
      expect(() =>
        parseEnvironment({
          BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
          BETTER_AUTH_URL: 'http://localhost:3000',
          DATABASE_URL: 'postgresql://localhost/mehran_dev',
          ...override,
        }),
      ).toThrow('Invalid configuration');
    }
  });
  it('coerces known settings without retaining unrelated environment secrets', () => {
    const result = parseEnvironment({
      BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
      BETTER_AUTH_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://localhost/mehran_dev',
      PORT: '4000',
      UNRELATED_SECRET: 'private',
    });
    expect(result.PORT).toBe(4000);
    expect(result).not.toHaveProperty('UNRELATED_SECRET');
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('requires an explicit isolated test URL and never falls back to DATABASE_URL', () => {
    expect(() =>
      isolatedTestDatabaseUrl({
        DATABASE_URL: 'postgresql://localhost/production',
      }),
    ).toThrow('TEST_DATABASE_URL is required');
    for (const url of [
      'postgresql://remote.example/mehran_test',
      'postgresql://localhost/mehran_dev',
      'postgresql://localhost/mehran_test?host=remote.example',
      'postgresql://localhost/mehran_test#anything',
    ]) {
      expect(() =>
        isolatedTestDatabaseUrl({ TEST_DATABASE_URL: url }),
      ).toThrow();
    }
    expect(() =>
      isolatedTestDatabaseUrl({
        NODE_ENV: 'production',
        TEST_DATABASE_URL: 'postgresql://localhost/mehran_test',
      }),
    ).toThrow('production');
    expect(() =>
      isolatedTestDatabaseUrl({
        DATABASE_URL: 'postgresql://localhost/mehran_test',
        TEST_DATABASE_URL: 'postgresql://127.0.0.1/mehran_test',
      }),
    ).toThrow('must differ');
    expect(
      isolatedTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgresql://localhost/mehran_test',
      }),
    ).toBe('postgresql://localhost/mehran_test');
  });
});
