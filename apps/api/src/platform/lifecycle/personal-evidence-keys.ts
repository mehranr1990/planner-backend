import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../../bootstrap/environment.js';

const key = z.string().min(32);
const purposes = ['control', 'identity', 'backup', 'capability'] as const;
type Purpose = (typeof purposes)[number];
const ring = z.record(
  z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  z.strictObject({
    control: key,
    identity: key,
    backup: key,
    capability: key,
  }),
);
export type PersonalEvidenceConfig = Pick<
  AppConfig,
  | 'BETTER_AUTH_SECRET'
  | 'PERSONAL_EVIDENCE_KEYS'
  | 'PERSONAL_EVIDENCE_ACTIVE_KEY_ID'
  | 'PERSONAL_EVIDENCE_LEGACY_KEY'
>;
/** Optional migration: no auth-key fallback is allowed once an explicit keyring is configured. */
export class PersonalEvidenceKeys {
  private readonly keys: z.infer<typeof ring>;
  private readonly active: string | undefined;
  private readonly legacy: string | undefined;
  get activeKeyId() {
    return this.active ?? null;
  }
  requireDigestKey(id: string | null | undefined) {
    if (id ? !this.keys[id] : !this.legacy)
      throw new Error(
        'Required Personal identity digest verification key unavailable',
      );
  }
  constructor(config: PersonalEvidenceConfig) {
    try {
      this.keys = config.PERSONAL_EVIDENCE_KEYS
        ? ring.parse(JSON.parse(config.PERSONAL_EVIDENCE_KEYS))
        : {};
      this.active = config.PERSONAL_EVIDENCE_ACTIVE_KEY_ID;
      if (
        Boolean(config.PERSONAL_EVIDENCE_KEYS) !== Boolean(this.active) ||
        (this.active && !this.keys[this.active])
      )
        throw new Error();
      const values = Object.values(this.keys).flatMap((v) =>
        purposes.map((p) => v[p]),
      );
      if (
        new Set(values).size !== values.length ||
        values.includes(config.BETTER_AUTH_SECRET) ||
        (config.PERSONAL_EVIDENCE_LEGACY_KEY &&
          values.includes(config.PERSONAL_EVIDENCE_LEGACY_KEY))
      )
        throw new Error();
      this.legacy =
        config.PERSONAL_EVIDENCE_LEGACY_KEY ??
        (this.active ? undefined : config.BETTER_AUTH_SECRET);
    } catch {
      throw new Error(
        'Invalid purpose-specific Personal evidence keys (values withheld)',
      );
    }
  }
  private mac(purpose: Purpose, body: string, id: string) {
    const material = this.keys[id]?.[purpose];
    if (!material)
      throw new Error(
        'Unknown Personal evidence key ID; retain referenced verification keys',
      );
    return createHmac('sha256', material)
      .update(`personal-evidence-v2:${purpose}:${id}:${body}`)
      .digest('hex');
  }
  sign(purpose: Purpose, body: string, legacyDomain: string) {
    if (this.active)
      return {
        version: 2 as const,
        keyId: this.active,
        signature: this.mac(purpose, body, this.active),
      };
    if (!this.legacy)
      throw new Error('Legacy Personal evidence key unavailable');
    return {
      version: 1 as const,
      signature: createHmac('sha256', this.legacy)
        .update(legacyDomain + body)
        .digest('hex'),
    };
  }
  verify(
    purpose: Purpose,
    body: string,
    envelope: {
      version?: number | undefined;
      keyId?: string | undefined;
      signature: string;
    },
    legacyDomain: string,
  ) {
    let expected: string;
    if (envelope.version === 2 && envelope.keyId)
      expected = this.mac(purpose, body, envelope.keyId);
    else if (
      (envelope.version === undefined || envelope.version === 1) &&
      !envelope.keyId &&
      this.legacy
    )
      expected = createHmac('sha256', this.legacy)
        .update(legacyDomain + body)
        .digest('hex');
    else
      throw new Error(
        'Unsupported Personal evidence version or missing legacy verification key',
      );
    const a = Buffer.from(expected, 'hex'),
      b = Buffer.from(envelope.signature, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new Error('Invalid Personal evidence signature');
  }
  digests(kind: 'identity' | 'space', id: string) {
    return [
      ...Object.keys(this.keys).map((k) =>
        this.mac('identity', kind + ':' + id, k),
      ),
      ...(this.legacy
        ? [
            createHmac('sha256', this.legacy)
              .update('erasure-' + kind + '-v1:' + id)
              .digest('hex'),
          ]
        : []),
    ];
  }
  digest(kind: 'identity' | 'space', id: string) {
    return this.active
      ? this.mac('identity', kind + ':' + id, this.active)
      : this.digests(kind, id)[0]!;
  }
  capabilities(id: string, kind: string) {
    return [
      ...Object.keys(this.keys).map(
        (k) =>
          'v2_' +
          k +
          '_' +
          Buffer.from(
            this.mac('capability', kind + ':' + id, k),
            'hex',
          ).toString('base64url'),
      ),
      ...(this.legacy
        ? [
            createHmac('sha256', this.legacy)
              .update('account-lifecycle-capability-v1:' + kind + ':' + id)
              .digest('base64url'),
          ]
        : []),
    ];
  }
  capability(id: string, kind: string) {
    return this.active
      ? 'v2_' +
          this.active +
          '_' +
          Buffer.from(
            this.mac('capability', kind + ':' + id, this.active),
            'hex',
          ).toString('base64url')
      : this.capabilities(id, kind)[0]!;
  }
}
