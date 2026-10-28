import { describe, it, expect } from 'vitest';
import { validWav } from './wav-policy.js';
import { validContent } from './content-policy.js';
function wav() {
  const b = Buffer.alloc(48);
  b.write('RIFF', 0);
  b.writeUInt32LE(40, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(4, 40);
  return b;
}
describe('private canonical WAV validation', () => {
  it('accepts correctly sized 16-bit PCM and routes through content policy', () => {
    const b = wav();
    expect(validWav(b, b.length)).toBe(true);
    expect(validContent('audio/wav', b, b, b.length)).toBe(true);
  });
  it('rejects mismatched/truncated/header-only WAV and nonaudio bytes', () => {
    const b = wav();
    for (const size of [undefined, 44, 47, 49, 10485761])
      expect(validWav(b, size)).toBe(false);
    expect(validWav(b.subarray(0, 43), 48)).toBe(false);
    expect(validWav(Buffer.from('plain text is not a voice file'), 48)).toBe(
      false,
    );
  });
  it('rejects fake codecs, inconsistent PCM fields and odd data alignment', () => {
    for (const offset of [4, 16, 20, 22, 24, 28, 32, 34, 40]) {
      const b = wav();
      b.writeUInt32LE(0, offset);
      expect(validWav(b, 48)).toBe(false);
    }
  });
});
