export function isolatedTestDatabaseUrl(
  environment: NodeJS.ProcessEnv,
): string {
  if (environment.NODE_ENV === 'production')
    throw new Error('Tests cannot run in production.');
  if (!environment.TEST_DATABASE_URL)
    throw new Error(
      'TEST_DATABASE_URL is required; use .env.test.local with an isolated local *_test database.',
    );
  let url: URL;
  try {
    url = new URL(environment.TEST_DATABASE_URL);
  } catch {
    throw new Error('Invalid TEST_DATABASE_URL (value withheld).');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^[a-zA-Z0-9_]+_test$/.test(name) ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Tests require loopback PostgreSQL, a database ending in _test, and no URL query/fragment.',
    );
  }
  if (environment.DATABASE_URL) {
    const application = new URL(environment.DATABASE_URL);
    if (application.port === url.port && application.pathname === url.pathname)
      throw new Error(
        'Test database must differ from the application database.',
      );
  }
  return url.toString();
}
