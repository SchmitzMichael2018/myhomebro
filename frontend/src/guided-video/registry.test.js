import { describe, expect, it } from 'vitest';
import { getGuidedVideo, resolveGuidedRoute } from './registry';

describe('guided video registry', () => {
  it('registers the reusable DIY tutorial and nine manual checkpoints', () => {
    const video = getGuidedVideo('diy-doesnt-mean-alone');
    expect(video.workspace).toBe('diy-planner');
    expect(video.checkpoints).toHaveLength(9);
    expect(
      video.checkpoints.every(
        (row) => row.completion.type === 'manual-acknowledgement'
      )
    ).toBe(true);
  });

  it('resolves portal routes without granting access or leaking a token elsewhere', () => {
    expect(
      resolveGuidedRoute(
        '/portal/:token?workspace=diy-planner',
        '/portal/safe-token'
      )
    ).toBe('/portal/safe-token?workspace=diy-planner');
    expect(
      resolveGuidedRoute(
        '/portal/:token?workspace=diy-planner',
        '/app/dashboard'
      )
    ).toBe('');
    expect(resolveGuidedRoute('https://example.com', '/portal/token')).toBe('');
  });
});
