import { describe, it, expect } from 'vitest';
import { suggestions, localDate } from './parse.js';
describe('explicit capture parsing preview', () => {
  it('recognizes only bounded trailing today/tomorrow and ISO dates', () => {
    expect(suggestions('Buy milk tomorrow', '2024-02-28')).toMatchObject({
      rawText: 'Buy milk tomorrow',
      title: 'Buy milk',
      scheduledDate: '2024-02-29',
      recognized: true,
    });
    expect(suggestions('Call Today', '2024-12-31').scheduledDate).toBe(
      '2024-12-31',
    );
    expect(suggestions('Call on 2024-02-29', '2024-01-01').recognized).toBe(
      true,
    );
  });
  it('preserves ambiguous/other-language phrases and invalid leap dates', () => {
    for (const text of [
      'Call next Tuesday',
      'Call on 2023-02-29',
      'tomorrow',
      String.fromCodePoint(
        0x62e,
        0x631,
        0x6cc,
        0x62f,
        0x20,
        0x641,
        0x631,
        0x62f,
        0x627,
      ),
      'Meeting 2024-01-01 notes',
    ])
      expect(suggestions(text, '2024-01-01')).toMatchObject({
        rawText: text,
        title: text,
        scheduledDate: null,
        recognized: false,
      });
  });
  it('uses the explicit local-day context across midnight/DST', () => {
    expect(
      localDate(new Date('2024-03-11T03:59:59Z'), 'America/New_York'),
    ).toBe('2024-03-10');
    expect(
      localDate(new Date('2024-03-11T04:00:00Z'), 'America/New_York'),
    ).toBe('2024-03-11');
    expect(suggestions('Review tomorrow', '2024-12-31').scheduledDate).toBe(
      '2025-01-01',
    );
  });
});
