import { describe, expect, it } from 'vitest';

import {
  diagnosticSiteKey,
  TURNSTILE_DIAGNOSTIC_SCRIPT_URL,
  TURNSTILE_DIAGNOSTIC_SITE_KEY,
} from './turnstileDiagnosticConfig.js';

describe('temporary Turnstile diagnostic configuration', () => {
  it('uses Cloudflare official visible always-pass test sitekey', () => {
    expect(TURNSTILE_DIAGNOSTIC_SITE_KEY).toBe('1x00000000000000000000AA');
    expect(TURNSTILE_DIAGNOSTIC_SCRIPT_URL).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    );
  });

  it('does not contain a Turnstile secret key', () => {
    expect(TURNSTILE_DIAGNOSTIC_SITE_KEY).not.toBe(
      '1x0000000000000000000000000000000AA'
    );
    expect(TURNSTILE_DIAGNOSTIC_SITE_KEY).toHaveLength(24);
  });

  it('selects the compiled public production site key only in production mode', () => {
    expect(diagnosticSiteKey('test', 'public-production-key')).toBe(
      TURNSTILE_DIAGNOSTIC_SITE_KEY
    );
    expect(diagnosticSiteKey('production', ' public-production-key ')).toBe(
      'public-production-key'
    );
    expect(diagnosticSiteKey('production', '')).toBe('');
  });
});
