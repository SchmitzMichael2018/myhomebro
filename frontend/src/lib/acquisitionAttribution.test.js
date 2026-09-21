import { describe, expect, it } from 'vitest';
import { attributionPayload, publicRouteEvent } from './acquisitionAttribution.js';

describe('acquisition attribution', () => {
  it('normalizes bounded UTM parameters', () => {
    const payload = attributionPayload('landing_view', {
      pathname: '/',
      search: '?utm_source=Google%3Cscript%3E&utm_medium=CPC&utm_campaign=Fall%20Launch&utm_content=x%22y',
    });
    expect(payload).toMatchObject({
      utm_source: 'googlescript',
      utm_medium: 'cpc',
      utm_campaign: 'Fall Launch',
      utm_content: 'xy',
    });
  });

  it('maps only meaningful public routes', () => {
    expect(publicRouteEvent('/')).toBe('landing_view');
    expect(publicRouteEvent('/register')).toBe('signup_started');
    expect(publicRouteEvent('/improvements/')).toBe('guide_view');
    expect(publicRouteEvent('/improvements/bathroom/')).toBe('guide_view');
    expect(
      publicRouteEvent('/improvements/bathroom/replace-bathroom-vanity/')
    ).toBeNull();
    expect(publicRouteEvent('/legal/privacy')).toBeNull();
  });
});
