export const TURNSTILE_STATE = Object.freeze({
  DISABLED: 'disabled',
  LOADING: 'loading',
  READY: 'ready',
  VERIFIED: 'verified',
  EXPIRED: 'expired',
  ERROR: 'error',
});

export const TURNSTILE_CONFIGURED = Boolean(
  String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()
);
