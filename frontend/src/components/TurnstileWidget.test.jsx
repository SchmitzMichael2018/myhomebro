import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import TurnstileWidget from './TurnstileWidget.jsx';
import { TURNSTILE_CONFIGURED, TURNSTILE_STATE } from './turnstileState.js';

describe('TurnstileWidget configuration', () => {
  it('renders no challenge when no site key is configured', () => {
    expect(TURNSTILE_CONFIGURED).toBe(false);
    expect(renderToStaticMarkup(<TurnstileWidget onToken={vi.fn()} />)).toBe('');
  });

  it('defines explicit lifecycle states for registration gating', () => {
    expect(TURNSTILE_STATE).toEqual({
      DISABLED: 'disabled',
      LOADING: 'loading',
      READY: 'ready',
      VERIFIED: 'verified',
      EXPIRED: 'expired',
      ERROR: 'error',
    });
  });
});
