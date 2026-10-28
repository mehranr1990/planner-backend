import { validWav } from './wav-policy.js';
/** Signature/type checks, not an antivirus or full document decoder. All downloads are attachments. */
export function validContent(
  mime: string,
  head: Uint8Array,
  tail: Uint8Array,
  size?: number,
): boolean {
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  switch (mime) {
    case 'audio/wav':
      return validWav(head, size);
    case 'image/png':
      return (
        hex(head.slice(0, 8)) === '89504e470d0a1a0a' &&
        hex(head.slice(12, 16)) === '49484452' &&
        hex(tail.slice(-8)) === '49454e44ae426082'
      );
    case 'image/jpeg':
      return (
        hex(head.slice(0, 3)) === 'ffd8ff' && hex(tail.slice(-2)) === 'ffd9'
      );
    case 'application/pdf':
      return (
        /^%PDF-(?:1\.[0-9]|2\.0)/.test(new TextDecoder().decode(head)) &&
        /%%EOF\s*$/.test(new TextDecoder().decode(tail))
      );
    case 'text/plain':
      return !/^\s*(?:<!doctype\s+html|<html\b|<svg\b|<\?xml\b)/i.test(
        new TextDecoder().decode(head),
      );
    default:
      return false;
  }
}
