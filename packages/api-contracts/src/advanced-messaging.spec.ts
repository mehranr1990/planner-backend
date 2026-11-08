import { it, expect } from 'vitest';
import { messagingPaths, advancedMessagingPaths } from './messaging-openapi.js';
import { advancedMessagingOperations } from './advanced-messaging-openapi.js';
it('publishes exactly eleven advanced REST operations alongside all fourteen foundation operations', () => {
  const foundation = messagingPaths(),
    advanced = advancedMessagingPaths();
  expect(Object.values(foundation).flatMap(Object.values)).toHaveLength(14);
  expect(advancedMessagingOperations).toHaveLength(11);
  expect(Object.values(advanced).flatMap(Object.values)).toHaveLength(11);
  expect(Object.keys(advanced).every((path) => !(path in foundation))).toBe(
    true,
  );
  expect(JSON.stringify(advanced)).not.toMatch(
    /websocket|socket\.io|typing|voice|attachments/i,
  );
});
