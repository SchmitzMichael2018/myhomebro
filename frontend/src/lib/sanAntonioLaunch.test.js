import { describe, expect, it } from 'vitest';
import { CONTRACTOR_SEARCH_HANDOFF, sanAntonioCtaUrl } from './sanAntonioLaunch.js';

describe('San Antonio launch handoffs', () => {
  it('uses the existing intake route for manual contractor search', () => {
    expect(CONTRACTOR_SEARCH_HANDOFF).toBe('/start-project');
    expect(sanAntonioCtaUrl(CONTRACTOR_SEARCH_HANDOFF)).toBe('/start-project?source=san_antonio_launch');
  });

  it('preserves supported attribution without arbitrary query parameters', () => {
    const destination = sanAntonioCtaUrl('/create-account?role=customer', '?utm_source=Local&utm_campaign=Fall+launch&ref=TEST-1&qr_source=flyer&next=%2Fadmin%2F&evil=%3Cscript%3E');
    const url = new URL(destination, 'https://www.myhomebro.com');
    expect(url.pathname).toBe('/create-account');
    expect(url.searchParams.get('role')).toBe('customer');
    expect(url.searchParams.get('utm_campaign')).toBe('Fall launch');
    expect(url.searchParams.get('ref')).toBe('TEST-1');
    expect(url.searchParams.get('qr_source')).toBe('flyer');
    expect(url.searchParams.has('next')).toBe(false);
    expect(url.searchParams.has('evil')).toBe(false);
  });

  it('does not overwrite an incoming source or preserve unsafe values', () => {
    const url = new URL(sanAntonioCtaUrl('/start-project', '?source=qr&ref=%3Cbad%3E'), 'https://www.myhomebro.com');
    expect(url.searchParams.get('source')).toBe('qr');
    expect(url.searchParams.has('ref')).toBe(false);
  });
});
