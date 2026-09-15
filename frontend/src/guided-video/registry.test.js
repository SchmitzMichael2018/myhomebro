import { describe, expect, it } from 'vitest';
import {
  getGuidedVideo,
  listGuidedVideosForAudience,
  resolveGuidedRoute,
} from './registry';

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

  it('publishes the contractor onboarding how-to library', () => {
    const videos = listGuidedVideosForAudience('contractor');
    expect(videos.map((video) => video.id)).toEqual([
      'create-contractor-profile',
      'connect-stripe-and-get-paid',
    ]);
    expect(
      videos.every((video) => video.videoSource && video.captionsSource)
    ).toBe(true);
    expect(videos.every((video) => video.placeholder === false)).toBe(true);
  });

  it('publishes a customer portal How-To video', () => {
    const videos = listGuidedVideosForAudience('customer');

    expect(videos.map((video) => video.id)).toEqual([
      'customer-portal-overview',
    ]);
    expect(videos[0]).toMatchObject({
      status: 'published',
      placeholder: false,
      workspace: 'Customer Portal',
    });
    expect(videos[0].videoSource).toContain(
      'myhomebro-homeowner-walkthrough.mp4'
    );
  });

  it('publishes a property manager portal How-To video', () => {
    const videos = listGuidedVideosForAudience('property_manager');

    expect(videos.map((video) => video.id)).toEqual([
      'property-manager-portal-overview',
    ]);
    expect(videos[0]).toMatchObject({
      status: 'published',
      placeholder: false,
      workspace: 'Property Manager Portal',
    });
    expect(videos[0].videoSource).toContain(
      'myhomebro-property-manager-walkthrough.mp4'
    );
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
