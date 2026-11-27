import { it } from 'vitest';
import { verifyRegistrationEmailUpgrade } from '../../../../tooling/testing/registration-email-upgrade.js';
it(
  'upgrades populated P0-P7/readiness data without inventing diagnostics history',
  verifyRegistrationEmailUpgrade,
  120000,
);
