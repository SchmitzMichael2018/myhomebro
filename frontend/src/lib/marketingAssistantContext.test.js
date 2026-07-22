import { describe, expect, it } from 'vitest';

import { buildMarketingAssistantContext, isAllowedMarketingNavigation } from './marketingAssistantContext.js';

const base = {
  profile: {
    business_name_public: 'Bright Build Co', primary_trade: 'Remodeling', specialties: ['Kitchens'],
    city: 'Austin', state: 'TX', is_public: true, public_url: '/contractors/bright-build-co', show_reviews: true,
  },
  websiteReadiness: {
    entitlements: { can_customize: true, can_publish: true },
    website: { status: 'draft', public_url: '/websites/bright-build-co', template_key: 'starter' },
    readiness: { missing_required_fields: [] }, publish_blockers: [],
  },
  galleryRows: [{ id: 1, title: 'Kitchen', is_public: true, is_featured: true, description: 'Private detail' }],
  reviewsRows: [{ id: 1, rating: 5, is_public: true, review_text: 'Private review text' }],
  websitePages: [{ page_type: 'home', title: 'Home', is_published: true }],
  heroContent: { headline: 'Reliable remodeling', subheadline: 'Clear work', cta_text: 'Request a Quote' },
};

describe('buildMarketingAssistantContext', () => {
  it('builds isolated compact Brand Kit context', () => {
    const context = buildMarketingAssistantContext({ ...base, activeStep: 'brand', brand: { missingPreferences: ['logo direction'] } });
    expect(context.workspace).toBe('marketing');
    expect(context.active_step).toBe('brand');
    expect(context.active_step_label).toBe('Brand Kit');
    expect(context.current_route).toBe('/app/marketing?tab=brand');
    expect(context.current_step_data.logo_state).toBe('missing');
    expect(context.current_step_data.incomplete_preferences).toEqual(['logo direction']);
    expect(JSON.stringify(context)).not.toContain('Private review text');
    expect(JSON.stringify(context)).not.toContain('Private detail');
    expect(context).not.toHaveProperty('agreement_id');
  });

  it('uses strict step-specific data and deterministic revision', () => {
    const reviews = buildMarketingAssistantContext({ ...base, activeStep: 'reviews' });
    const seo = buildMarketingAssistantContext({ ...base, activeStep: 'seo' });
    expect(reviews.current_step_data).toMatchObject({ total_count: 1, public_count: 1, average_rating: 5 });
    expect(reviews.current_step_data).not.toHaveProperty('has_search_title');
    expect(seo.current_step_data).toHaveProperty('has_search_title');
    expect(reviews.context_revision).not.toBe(seo.context_revision);
  });

  it('allows only canonical Marketing navigation', () => {
    const context = buildMarketingAssistantContext({ ...base, activeStep: 'final' });
    expect(isAllowedMarketingNavigation('/app/marketing?tab=gallery', context)).toBe(true);
    expect(isAllowedMarketingNavigation('/app/agreements', context)).toBe(false);
  });
});
