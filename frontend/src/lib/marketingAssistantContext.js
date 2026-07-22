export const MARKETING_STEP_LABELS = {
  overview: 'Overview',
  decision: 'Website Decision',
  profile: 'Business Information',
  brand: 'Brand Kit',
  gallery: 'Portfolio',
  reviews: 'Reviews',
  website: 'Content',
  seo: 'SEO & Visibility',
  final: 'Final Review',
  publish: 'Publish',
};

export const MARKETING_NAVIGATION_TARGETS = {
  overview: '/app/marketing?tab=overview',
  decision: '/app/marketing?tab=decision',
  profile: '/app/marketing?tab=profile',
  brand: '/app/marketing?tab=brand',
  gallery: '/app/marketing?tab=gallery',
  reviews: '/app/marketing?tab=reviews',
  website: '/app/marketing?tab=website',
  seo: '/app/marketing?tab=seo',
  final: '/app/marketing?tab=final',
  publish: '/app/marketing?tab=publish',
};

const NEXT_STEP = {
  overview: 'decision', decision: 'profile', profile: 'brand', brand: 'gallery', gallery: 'reviews',
  reviews: 'website', website: 'seo', seo: 'final', final: 'publish', publish: 'overview',
};

const SUPPORTED_BY_STEP = {
  overview: ['explain_readiness', 'summarize_blockers', 'recommend_next_step', 'navigate_marketing_step'],
  decision: ['explain_website_choices', 'explain_url_requirements', 'navigate_marketing_step'],
  profile: ['explain_missing_fields', 'explain_visibility', 'prepare_business_description', 'navigate_marketing_step'],
  brand: ['explain_brand_options', 'prepare_brand_direction', 'prepare_tagline', 'navigate_marketing_step'],
  gallery: ['explain_portfolio_visibility', 'explain_permission_guidance', 'prepare_portfolio_copy', 'navigate_marketing_step'],
  reviews: ['explain_review_visibility', 'recommend_review_action', 'navigate_marketing_step'],
  website: ['explain_content_gaps', 'explain_website_style', 'prepare_content_copy', 'navigate_marketing_step'],
  seo: ['explain_search_readiness', 'prepare_search_copy', 'explain_local_information', 'navigate_marketing_step'],
  final: ['summarize_blockers', 'explain_publish_eligibility', 'explain_preview_modes', 'navigate_marketing_step'],
  publish: ['explain_publication', 'explain_sharing', 'recommend_post_launch_action', 'navigate_marketing_step'],
};

function compactList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function buildMarketingAssistantContext({
  activeStep = 'overview', profile = {}, websiteReadiness = {}, galleryRows = [], reviewsRows = [],
  websitePages = [], heroContent = {}, readinessRows = [], recommendations = [], validation = {}, brand = {},
} = {}) {
  const step = MARKETING_STEP_LABELS[activeStep] ? activeStep : 'overview';
  const website = websiteReadiness.website || {};
  const readiness = websiteReadiness.readiness || {};
  const publishBlockers = compactList(websiteReadiness.publish_blockers);
  const publicPortfolio = galleryRows.filter((item) => item?.is_public !== false);
  const featuredPortfolio = galleryRows.filter((item) => item?.is_featured);
  const publicReviews = reviewsRows.filter((item) => item?.is_public);
  const averageRating = reviewsRows.length
    ? reviewsRows.reduce((sum, item) => sum + Number(item?.rating || 0), 0) / reviewsRows.length
    : null;
  const services = [...new Set([
    ...compactList(profile.work_types), ...compactList(profile.specialties), profile.primary_trade,
  ].filter(Boolean))];
  const missingFields = compactList(readiness.missing_required_fields);
  const currentStepData = {
    overview: {
      required_blockers: publishBlockers,
      recommendations: compactList(recommendations).slice(0, 5),
      website_status: website.status || 'draft',
      public_profile: Boolean(profile.is_public),
      portfolio_count: publicPortfolio.length,
      review_count: publicReviews.length,
    },
    decision: {
      has_existing_website: Boolean(profile.has_existing_website),
      external_website_url: profile.existing_website_url || '',
      url_validation_state: validation.websiteDecisionError ? 'invalid' : 'valid',
    },
    profile: {
      missing_fields: missingFields,
      name: profile.business_name_public || '', trade: profile.primary_trade || '', services,
      city: profile.city || '', state: profile.state || '', service_area: profile.service_area_text || '',
      has_description: Boolean(profile.bio),
      visibility: { phone: profile.show_phone_public !== false, email: profile.show_email_public !== false },
      trust_attribute_count: compactList(profile.customer_trust_badges).length,
    },
    brand: {
      logo_state: profile.logo_url ? 'available' : 'missing',
      cover_photo_state: profile.cover_image_url || profile.hero_image_url ? 'available' : 'missing',
      primary_color: profile.brand_primary_color || '', accent_color: profile.brand_accent_color || '',
      text_style: profile.brand_font_theme || '', writing_style: profile.proposal_tone || '',
      tagline: profile.tagline || '', incomplete_preferences: compactList(brand.missingPreferences),
    },
    gallery: {
      total_count: galleryRows.length, public_count: publicPortfolio.length,
      hidden_count: galleryRows.length - publicPortfolio.length, featured_count: featuredPortfolio.length,
      editor_open: Boolean(validation.galleryEditorOpen),
      editor_draft: validation.galleryEditorOpen ? {
        has_title: Boolean(validation.galleryForm?.title), has_type: Boolean(validation.galleryForm?.category),
        has_description: Boolean(validation.galleryForm?.description), has_image: Boolean(validation.galleryImage),
        is_public: validation.galleryForm?.is_public !== false, is_featured: Boolean(validation.galleryForm?.is_featured),
      } : null,
    },
    reviews: {
      total_count: reviewsRows.length, public_count: publicReviews.length,
      hidden_count: reviewsRows.length - publicReviews.length, average_rating: averageRating,
      display_enabled: profile.show_reviews !== false,
      review_link_available: Boolean(profile.public_url),
    },
    website: {
      selected_style: website.template_key || 'starter',
      pages: websitePages.map((page) => ({ type: page.page_type, title: page.title, published: Boolean(page.is_published) })),
      homepage: { has_headline: Boolean(heroContent.headline), has_subheadline: Boolean(heroContent.subheadline), has_cta: Boolean(heroContent.cta_text) },
      service_count: services.length, preview_available: Boolean(websitePages.length),
    },
    seo: {
      has_search_title: Boolean(profile.seo_title), has_search_description: Boolean(profile.seo_description),
      service_phrase_count: compactList(profile.specialties).length,
      local_business_complete: Boolean(profile.business_name_public && profile.primary_trade && (profile.city || profile.service_area_text)),
      profile_is_public: Boolean(profile.is_public), recommendations: compactList(recommendations).slice(0, 5),
    },
    final: {
      required_blockers: publishBlockers, optional_recommendations: compactList(recommendations).slice(0, 5),
      section_readiness: readinessRows.map((item) => ({ label: item.label, complete: Boolean(item.complete), required: Boolean(item.required) })),
      can_publish: publishBlockers.length === 0 && Boolean(websiteReadiness.entitlements?.can_publish || websiteReadiness.entitlements?.development_override_active),
      preview_available: Boolean(websitePages.length),
    },
    publish: {
      state: String(website.status || 'draft').toLowerCase(), blockers: publishBlockers,
      public_url: website.public_url || '', published_at: website.published_at || website.last_published_at || websiteReadiness.published_at || null,
      public_profile_visible: Boolean(profile.is_public), reviews_visible: profile.show_reviews !== false && publicReviews.length > 0,
      public_review_count: publicReviews.length, public_portfolio_count: publicPortfolio.length,
      share_actions: ['copy_website_link', ...(profile.public_url ? ['open_public_profile'] : []),
        ...(websiteReadiness.qr_available ? ['download_profile_qr'] : [])],
    },
  }[step];
  const completedSteps = readinessRows.filter((item) => item.complete).map((item) => item.label);
  const revisionParts = [step, website.status || 'draft', profile.updated_at || '', website.updated_at || '',
    missingFields.join(','), publicPortfolio.length, publicReviews.length, Boolean(heroContent.headline), Boolean(profile.seo_title)];
  return {
    schema_version: 1,
    workspace: 'marketing', workspace_mode: 'marketing', page: 'marketing',
    route: '/app/marketing', current_route: MARKETING_NAVIGATION_TARGETS[step],
    active_step: step, active_step_label: MARKETING_STEP_LABELS[step],
    context_revision: `marketing:${revisionParts.join(':')}`,
    marketing_goal: {
      current_objective: `Complete ${MARKETING_STEP_LABELS[step]}`,
      next_recommended_step: MARKETING_STEP_LABELS[NEXT_STEP[step]],
      launch_state: String(website.status || 'draft').toLowerCase(),
    },
    business: {
      name: profile.business_name_public || '', owner_contact_name: profile.owner_contact_name || '',
      trade: profile.primary_trade || '', services, city: profile.city || '', state: profile.state || '',
      service_area: profile.service_area_text || '', years_in_business: profile.years_in_business || null,
      has_description: Boolean(profile.bio), public_phone_enabled: profile.show_phone_public !== false,
      public_email_enabled: profile.show_email_public !== false, trust_attributes: compactList(profile.customer_trust_badges),
    },
    website: {
      status: website.status || 'draft', public_url: website.public_url || '',
      is_published: String(website.status || '').toLowerCase() === 'published', selected_style: website.template_key || 'starter',
      can_customize: Boolean(websiteReadiness.entitlements?.can_customize || websiteReadiness.entitlements?.development_override_active),
      can_publish: publishBlockers.length === 0 && Boolean(websiteReadiness.entitlements?.can_publish || websiteReadiness.entitlements?.development_override_active),
      publish_blockers: publishBlockers, has_homepage: websitePages.some((page) => page.page_type === 'home'),
      has_headline: Boolean(heroContent.headline), has_subheadline: Boolean(heroContent.subheadline), has_cta: Boolean(heroContent.cta_text),
    },
    profile: { is_public: Boolean(profile.is_public), public_url: profile.public_url || '', show_reviews: profile.show_reviews !== false },
    portfolio: { total_count: galleryRows.length, public_count: publicPortfolio.length, featured_count: featuredPortfolio.length },
    reviews: { total_count: reviewsRows.length, public_count: publicReviews.length, average_rating: averageRating },
    current_step_data: currentStepData,
    readiness: { required_blockers: publishBlockers, recommendations: compactList(recommendations).slice(0, 5), completed_steps: completedSteps },
    supported_actions: SUPPORTED_BY_STEP[step],
    prohibited_actions: ['publish_website', 'send_review_request', 'change_visibility', 'apply_without_review', 'invent_business_fact', 'navigate_unrelated_workspace'],
    navigation_targets: MARKETING_NAVIGATION_TARGETS,
  };
}

export function isAllowedMarketingNavigation(route, context) {
  return Object.values(context?.navigation_targets || MARKETING_NAVIGATION_TARGETS).includes(route);
}
