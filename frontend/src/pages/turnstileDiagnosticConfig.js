// Cloudflare's documented visible, always-pass test sitekey.
export const TURNSTILE_DIAGNOSTIC_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_DIAGNOSTIC_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function diagnosticSiteKey(mode, productionSiteKey = '') {
  return mode === 'production'
    ? String(productionSiteKey || '').trim()
    : TURNSTILE_DIAGNOSTIC_SITE_KEY;
}
