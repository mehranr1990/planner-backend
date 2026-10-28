import { describe, it, expect } from 'vitest';
import * as c from './writing.js';
import { FileUploadSchema } from './files.js';
import { VoiceFileUploadSchema } from './voice-files.js';
describe('private writing/capture contracts', () => {
  const content = { format: 'MARKDOWN', version: 1, content: 'Private text' };
  it('version-checks content and rejects executable markup/URI/control payloads', () => {
    for (const text of [
      '<script>alert(1)</script>',
      '[x](javascript:alert(1))',
      'data:text/html,x',
      'bad\u0000text',
    ])
      expect(
        c.WritingContentSchema.safeParse({ ...content, content: text }).success,
      ).toBe(false);
    expect(
      c.WritingContentSchema.safeParse({ ...content, version: 2 }).success,
    ).toBe(false);
  });
  it('bounds notes by characters and UTF-8 bytes without silent truncation', () => {
    expect(
      c.NoteCreateSchema.safeParse({
        title: 'x',
        content: { ...content, content: 'x'.repeat(50000) },
      }).success,
    ).toBe(true);
    expect(
      c.NoteCreateSchema.safeParse({
        title: 'x',
        content: { ...content, content: 'x'.repeat(50001) },
      }).success,
    ).toBe(false);
    expect(
      c.NoteCreateSchema.safeParse({
        title: 'x',
        content: {
          ...content,
          content: String.fromCodePoint(0x754c).repeat(40000),
        },
      }).success,
    ).toBe(false);
  });
  it('rejects ownership/internal-state injection', () => {
    for (const key of [
      'spaceId',
      'createdByUserId',
      'revision',
      'targetTaskId',
    ])
      expect(
        c.CaptureCreateSchema.safeParse({
          type: 'DRAFT',
          text: 'x',
          [key]: 'foreign',
        }).success,
      ).toBe(false);
  });
  it('requires explicit capture type and valid source data', () => {
    expect(c.CaptureCreateSchema.safeParse({ text: 'x' }).success).toBe(false);
    expect(
      c.CaptureCreateSchema.safeParse({ type: 'VOICE_MEMO' }).success,
    ).toBe(false);
    expect(
      c.CaptureCreateSchema.safeParse({ type: 'DRAFT', text: '' }).success,
    ).toBe(false);
  });
  it('validates subjective mood/energy scales and real attributed dates', () => {
    for (const mood of [0, 6, -1, 1.5])
      expect(c.MoodCreateSchema.safeParse({ mood }).success).toBe(false);
    expect(c.MoodCreateSchema.safeParse({ mood: 3, energy: 6 }).success).toBe(
      false,
    );
    expect(
      c.JournalCreateSchema.safeParse({ content, localDate: '2024-02-30' })
        .success,
    ).toBe(false);
  });
  it('keeps date/timezone immutable in corrections and leaves unrelated patch fields unchanged', () => {
    expect(
      c.JournalPatchSchema.safeParse({ localDate: '2024-01-01' }).success,
    ).toBe(false);
    expect(c.MoodPatchSchema.safeParse({ timezone: 'UTC' }).success).toBe(
      false,
    );
    expect(c.NotePatchSchema.parse({ title: 'new' })).toEqual({ title: 'new' });
    expect(c.NoteFolderPatchSchema.parse({ title: 'new' })).toEqual({
      title: 'new',
    });
  });
  it('uses explicit supported triage payloads and rejects future finance actions', () => {
    expect(
      c.CaptureTriageSchema.safeParse({
        action: 'CREATE_TASK',
        task: { title: 'x' },
      }).success,
    ).toBe(true);
    expect(
      c.CaptureTriageSchema.safeParse({ action: 'POST_EXPENSE', amount: '1' })
        .success,
    ).toBe(false);
    expect(
      c.CaptureTriageSchema.safeParse({
        action: 'CREATE_TASK',
        task: { title: 'x' },
        force: true,
      }).success,
    ).toBe(false);
  });
  it('preserves legacy file MIME contracts while adding separate voice contracts', () => {
    const payload = {
      filename: 'memo.wav',
      mimeType: 'audio/wav',
      expectedSize: 48,
    };
    expect(FileUploadSchema.safeParse(payload).success).toBe(false);
    expect(VoiceFileUploadSchema.safeParse(payload).success).toBe(true);
  });
  it('rejects arbitrary search DSL and unsupported date windows', () => {
    expect(
      c.PersonalSearchQuerySchema.safeParse({ q: 'x', sql: 'select private' })
        .success,
    ).toBe(false);
    expect(
      c.PersonalSearchQuerySchema.safeParse({ q: 'x', types: 'FINANCE' })
        .success,
    ).toBe(false);
    expect(
      c.JournalQuerySchema.safeParse({ from: '2024-01-01', to: '2026-01-01' })
        .success,
    ).toBe(false);
  });
});
