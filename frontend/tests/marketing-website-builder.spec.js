import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseProfile = {
  slug: 'bright-build-co',
  business_name_public: 'Bright Build Co',
  tagline: '',
  bio: 'We help homeowners with clean, reliable project delivery.',
  city: 'Austin',
  state: 'TX',
  service_area_text: 'Austin metro',
  phone_public: '555-111-2222',
  email_public: 'hello@bright.example.com',
  show_phone_public: true,
  show_email_public: false,
  allow_public_intake: true,
  is_public: true,
  public_url: 'http://localhost:4173/contractors/bright-build-co',
  brand_primary_color: '#2563eb',
  brand_accent_color: '#14b8a6',
};

function makeWebsitePayload({ pro = false, published = false, developmentOverride = false, statusOverride = '' } = {}) {
  const status = statusOverride || (published ? 'published' : 'draft');
  const pages = [
    {
      id: 10,
      page_type: 'home',
      slug: '',
      title: 'Home',
      seo_title: 'Bright Build Co',
      seo_description: 'Austin contractor',
      is_published: true,
      sort_order: 0,
      content_blocks: {
        hero: {
          headline: 'Reliable remodeling in Austin',
          subheadline: 'Clear scopes, clean work, and dependable communication.',
          cta_text: 'Request a Quote',
        },
      },
    },
    {
      id: 11,
      page_type: 'services',
      slug: 'services',
      title: 'Services',
      seo_title: '',
      seo_description: '',
      is_published: true,
      sort_order: 1,
      content_blocks: { services: { heading: 'Services', intro: 'Remodeling and repairs.' } },
    },
    {
      id: 12,
      page_type: 'contact',
      slug: 'contact',
      title: 'Contact',
      seo_title: '',
      seo_description: '',
      is_published: true,
      sort_order: 4,
      content_blocks: {
        contact: {
          heading: 'Start your project',
          body: 'Share the basics and we will follow up.',
          cta_text: 'Start Your Project',
          intake_intro: 'Tell us about the project and timeline.',
          lead_form_enabled: true,
        },
      },
    },
  ];
  const profile = {
    identity: {
      business_name: 'Bright Build Co',
      tagline: 'Built cleanly, managed clearly',
      bio: baseProfile.bio,
    },
    branding: {
      primary_color: '#2563eb',
      accent_color: '#14b8a6',
      font_theme: 'modern',
    },
    images: {},
    service_area: {
      city: 'Austin',
      state: 'TX',
      service_area_text: 'Austin metro',
    },
    services: {
      specialties: ['Kitchen remodels'],
      work_types: ['Renovation'],
      skills: ['Carpentry'],
    },
    contact: {
      phone_public: '555-111-2222',
      email_public: 'hello@bright.example.com',
      show_phone_public: true,
      show_email_public: false,
      allow_public_intake: true,
    },
    trust: { license_public: true },
    gallery: {
      count: 1,
      items: [{ id: 1, title: 'Kitchen update', image_url: '', description: 'Clean finish work' }],
    },
    reviews: {
      count: 1,
      selected: [{ id: 1, reviewer_name: 'Sam', rating: 5, public_comment: 'Great communication.' }],
    },
  };

  return {
    entitlements: {
      plan: pro ? 'pro' : 'trial',
      access_state: pro ? 'website_pro_active' : 'website_trial_active',
      days_remaining: pro ? 0 : 14,
      development_override_active: developmentOverride,
      can_customize: true,
      can_publish: pro || developmentOverride,
      can_use_ai_limited: !pro,
      can_use_ai_full: pro,
      features: {
        public_profile: { key: 'public_profile', enabled: true, tier: 'free', label: 'Free public profile' },
        website_builder: {
          key: 'website_builder',
          enabled: true,
          tier: 'pro',
          label: 'Website Builder',
          reason: '',
        },
        website_publish: {
          key: 'website_publish',
          enabled: pro || developmentOverride,
          tier: 'pro',
          label: 'Publish website',
          reason: pro || developmentOverride ? '' : 'Publishing is available during an active Website Builder plan.',
        },
        website_ai_copy: {
          key: 'website_ai_copy',
          enabled: true,
          tier: pro ? 'growth' : 'trial',
          label: 'AI website copy',
          reason: '',
        },
      },
    },
    website: {
      id: 3,
      status,
      template_key: 'starter',
      public_url: '/websites/bright-build-co',
      homepage_layout: {
        branding: { primary_color: '#2563eb', accent_color: '#14b8a6', font_theme: 'modern' },
        sections: { hero: true, services: true, portfolio: true, reviews: true, trust: true, contact: true },
        section_order: ['hero', 'services', 'portfolio', 'reviews', 'trust', 'contact'],
      },
    },
    pages,
    profile,
    readiness: {
      score: pro ? 94 : 78,
      complete_count: pro ? 9 : 7,
      total_count: 9,
      missing_required_fields: pro ? [] : ['tagline'],
      checklist: [
        { key: 'business_name', label: 'Add public business name', complete: true, required: true },
        {
          key: 'tagline',
          label: 'Add a tagline',
          complete: pro,
          required: true,
          action: 'Summarize what you do in one short line.',
        },
      ],
    },
    draft: { status, has_draft: true, template_key: 'starter' },
    publish_blockers: pro || developmentOverride ? [] : ['Publishing is part of the Pro Website Builder.'],
    recommended_next_steps: pro
      ? []
      : [{ key: 'tagline', label: 'Add a tagline', action: 'Summarize what you do in one short line.' }],
  };
}

async function mockMarketingPage(page, { pro = false, developmentOverride = false, statusOverride = '' } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let websitePayload = makeWebsitePayload({ pro, developmentOverride, statusOverride });
  let publicPayload = null;

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });

  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_status: 'complete', connected: true }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
        business_name: 'Bright Build Co',
        contractor_onboarding_status: 'complete',
      }),
    });
  });

  await page.route(/public-profile\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(baseProfile),
    });
  });

  await page.route(/public-profile\/qr\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
      }),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: 1,
            title: 'Kitchen update',
            category: 'Kitchen remodel',
            image_url: '',
            description: 'Clean finish work',
            is_public: true,
            is_featured: true,
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(/\/api\/projects\/(?:contractor\/public-leads|contractor-opportunities)\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/website\/pages\/\d+\/?$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      const match = route.request().url().match(/pages\/(\d+)\/?$/);
      const pageId = Number(match?.[1] || 0);
      websitePayload = {
        ...websitePayload,
        pages: websitePayload.pages.map((pageRow) =>
          pageRow.id === pageId
            ? {
                ...pageRow,
                ...patch,
                content_blocks: {
                  ...(pageRow.content_blocks || {}),
                  ...(patch.content_blocks || {}),
                },
              }
            : pageRow
        ),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages: websitePayload.pages }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(/\/api\/projects\/contractor\/website\/publish\/?$/, async (route) => {
    if (!pro && !developmentOverride) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, blockers: ['Publishing is part of the Pro Website Builder.'] }),
      });
      return;
    }
    websitePayload = {
      ...websitePayload,
      website: { ...websitePayload.website, status: 'published' },
      draft: { ...websitePayload.draft, status: 'published' },
    };
    publicPayload = {
      version: 1,
      website: websitePayload.website,
      profile: websitePayload.profile,
      pages: websitePayload.pages,
      homepage_layout: websitePayload.website.homepage_layout,
      current_page: websitePayload.pages[0],
      published_at: '2026-06-24T12:00:00Z',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, website: websitePayload.website, snapshot: publicPayload }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/website\/pause\/?$/, async (route) => {
    websitePayload = {
      ...websitePayload,
      website: { ...websitePayload.website, status: 'paused' },
      draft: { ...websitePayload.draft, status: 'paused' },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, website: websitePayload.website }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/website\/preview\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...websitePayload,
        preview: {
          mode: 'draft',
          can_publish: pro || developmentOverride,
          publish_disabled_reason: pro || developmentOverride ? '' : 'Publishing is available during an active Website Builder plan.',
          public_safe: true,
        },
        homepage_layout: websitePayload.website.homepage_layout,
      }),
    });
  });

  await page.route(/\/api\/projects\/contractor\/website\/?$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      websitePayload = {
        ...websitePayload,
        website: {
          ...websitePayload.website,
          template_key: patch.template_key || websitePayload.website.template_key,
          homepage_layout: patch.homepage_layout || websitePayload.website.homepage_layout,
        },
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(websitePayload),
    });
  });

  await page.route(/\/api\/projects\/contractor\/website\/ai-assist\/?$/, async (route) => {
    const body = route.request().postDataJSON();
    const suggestions = {
      business_description: 'Bright Build Co delivers clean Austin remodels with clear schedules, careful finish work, and dependable communication.',
      photo_title: 'Finished kitchen remodel',
      photo_caption: 'A bright kitchen update with improved storage, lighting, and clean finish details.',
      photo_category: 'Kitchen remodel',
      review_summary: 'Customers consistently mention clear communication and careful finish work.',
      hero_headline: 'Austin remodeling without project chaos',
      hero_subheadline: 'Premium remodeling, handled clearly from first walkthrough to final punch list.',
      cta_text: 'Start a Project',
      seo_title: 'Bright Build Co | Austin Remodeling Contractor',
      seo_description: 'Austin remodeling contractor helping homeowners plan clean, reliable kitchen and home updates.',
      seo_keywords: 'Austin remodeling, kitchen remodel, home renovation',
      final_website_audit: 'Your website is ready to publish. Strengthen the hero, add one more project photo, and keep the CTA direct.',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        action: body.action,
        configured: true,
        suggested_value: suggestions[body.action] || 'Premium remodeling, handled clearly',
        explanation: 'This keeps the copy specific and customer-facing.',
      }),
    });
  });

  await page.route(/\/api\/projects\/public\/websites\/bright-build-co\/?$/, async (route) => {
    if (!publicPayload) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Website not found.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(publicPayload),
    });
  });

  await page.route(/\/api\/projects\/public\/websites\/bright-build-co\/intake\/?$/, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: 'Your request was sent to Bright Build Co.',
        intake_id: 42,
        lead_id: 52,
        source: 'website',
        source_label: 'Website',
      }),
    });
  });
}

test('Marketing Website Builder tab loads the new Design & Content step with dev override', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true, statusOverride: 'paused' });

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('online-presence-setup-shell')).toBeVisible();
  await expect(page.getByTestId('marketing-website-builder-tab')).toBeVisible();
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Content');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('SEO');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Review');
  await expect(page.getByTestId('website-builder-design-tab')).toContainText('Developer Override Active');
  await expect(page.getByText('Your website is saved but paused. Choose a plan to reactivate customization.')).toHaveCount(0);
  await expect(page.getByTestId('website-builder-preview-toggle')).toHaveCount(0);
  await expect(page.getByTestId('website-builder-preview-button')).toBeVisible();
  await expect(page.getByTestId('website-builder-preview-button')).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('website-builder-preview-button')).toHaveAttribute('href', /\/app\/marketing\/preview\?mode=desktop$/);
  await expect(page.getByTestId('marketing-website-builder-tab').getByTestId('public-website-renderer')).toHaveCount(0);

  const themeState = await page.getByTestId('online-presence-setup-shell').evaluate((shell) => {
    const parseRgb = (value) => {
      const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? match.slice(1, 4).map(Number) : null;
    };
    const isLight = (rgb, min = 240) => Array.isArray(rgb) && rgb.every((value) => value >= min);
    const designCard = document.querySelector('[data-testid="website-builder-design-tab"]');
    const input = document.querySelector('[data-testid="website-builder-hero-headline"]');
    const sidebar = document.querySelector('.mhb-sidebar-shell');
    const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
    const sidebarRgb = sidebarStyle ? parseRgb(sidebarStyle.backgroundColor) : null;
    return {
      shellHasLightClass: shell.classList.contains('mhb-online-presence-light-theme'),
      shellIsLight: isLight(parseRgb(getComputedStyle(shell).backgroundColor), 240),
      cardIsLight: isLight(parseRgb(getComputedStyle(designCard).backgroundColor), 245),
      inputIsLight: isLight(parseRgb(getComputedStyle(input).backgroundColor), 245),
      sidebarIsDark:
        Boolean(sidebar) &&
        (sidebarStyle.backgroundImage.includes('gradient') ||
          (Array.isArray(sidebarRgb) && sidebarRgb[0] < 35 && sidebarRgb[1] < 55 && sidebarRgb[2] < 90)),
    };
  });
  expect(themeState).toEqual({
    shellHasLightClass: true,
    shellIsLight: true,
    cardIsLight: true,
    inputIsLight: true,
    sidebarIsDark: true,
  });

  const layoutState = await page.getByTestId('marketing-website-builder-tab').evaluate((root) => {
    const editor = root.querySelector('[data-testid="website-builder-design-tab"]');
    const main = root.closest('main');
    const rootRect = root.getBoundingClientRect();
    const editorRect = editor?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    return {
      shellUsesAvailableWidth: Boolean(mainRect && rootRect.width >= mainRect.width * 0.9),
      editorUsesAvailableWidth: Boolean(editorRect && editorRect.width >= rootRect.width * 0.9),
      previewHasRenderer: Boolean(root.querySelector('[data-testid="public-website-renderer"]')),
      documentFits: document.documentElement.scrollWidth <= window.innerWidth + 2,
    };
  });
  expect(layoutState).toEqual({
    shellUsesAvailableWidth: true,
    editorUsesAvailableWidth: true,
    previewHasRenderer: false,
    documentFits: true,
  });

  await expect(page.getByTestId('website-builder-primary-color')).toBeEnabled();
  await page.getByTestId('website-builder-primary-color').fill('#0f766e');
  await expect(page.getByTestId('website-builder-save-page')).toBeEnabled();
  await page.goto('/app/marketing/preview?mode=mobile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('contractor-website-preview-page')).toBeVisible();
  await expect(page.getByTestId('full-preview-mobile-frame')).toBeVisible();
  await expect(page.getByTestId('public-website-renderer')).toBeVisible();
  const mobileFrame = await page.getByTestId('full-preview-mobile-frame').evaluate((root) => {
    const phone = root.querySelector('.rounded-\\[2\\.5rem\\]');
    const rect = phone?.getBoundingClientRect();
    return {
      phoneWidth: Math.round(rect?.width || 0),
      documentFits: document.documentElement.scrollWidth <= window.innerWidth + 2,
    };
  });
  expect(mobileFrame.phoneWidth).toBeGreaterThanOrEqual(340);
  expect(mobileFrame.phoneWidth).toBeLessThanOrEqual(420);
  expect(mobileFrame.documentFits).toBe(true);

  await page.getByRole('button', { name: 'Desktop' }).click();
  await expect(page.getByTestId('full-preview-desktop-frame')).toBeVisible();
  const desktopFrame = await page.getByTestId('full-preview-desktop-canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return Math.round(rect.width);
  });
  expect(desktopFrame).toBeGreaterThanOrEqual(900);

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Publish/ }).click();
  await expect(page.getByTestId('online-presence-publish-tab')).toContainText('Ready to Publish');
  await expect(page.getByTestId('website-builder-publish-button')).toBeEnabled();
});

test('Website Decision uses selectable cards and one progression action', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Website Decision' }).click();

  const step = page.getByTestId('website-decision-step');
  const noWebsite = page.getByTestId('website-decision-no-website');
  const existingWebsite = page.getByTestId('website-decision-existing-website');
  await expect(step).toContainText('Website Decision');
  await expect(step).not.toContainText('Step 0 of 7');
  await expect(noWebsite).toHaveAttribute('role', 'radio');
  await expect(noWebsite).toHaveAttribute('aria-checked', 'true');
  await expect(existingWebsite).toHaveAttribute('role', 'radio');
  await existingWebsite.click();
  await expect(existingWebsite).toHaveAttribute('aria-checked', 'true');
  await expect(step).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('online-presence-leads-handoff')).toHaveCount(0);
  await expect(existingWebsite).toContainText('MyHomeBro will analyze the existing website');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('Business Information uses a live public preview and saves before continuing', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  await page.goto('/app/marketing?tab=profile', { waitUntil: 'domcontentloaded' });

  const step = page.getByTestId('public-presence-profile-tab');
  await expect(step).toBeVisible();
  await expect(step).toContainText('Business Details');
  await expect(step).toContainText('Services');
  await expect(step).toContainText('Public Display & Trust');
  await expect(step).not.toContainText('Step 1 of 7');
  await expect(step).not.toContainText('Your Progress');
  await expect(step).not.toContainText('override');
  await expect(page.getByTestId('public-presence-qr-image')).toHaveCount(0);
  await expect(page.getByTestId('online-presence-leads-handoff')).toHaveCount(0);
  await expect(page.getByTestId('business-information-inherited-copy')).toContainText('Changes here only affect your public website and profile');
  await expect(page.getByTestId('business-public-profile-preview')).toContainText('Bright Build Co');
  await expect(page.getByTestId('business-preview-phone')).toContainText('555-111-2222');
  await expect(page.getByTestId('business-preview-email')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add custom trade' }).click();
  await expect(page.getByTestId('business-primary-trade-custom')).toBeVisible();
  await page.getByTestId('business-primary-trade-custom').fill('Restoration');
  await expect(page.getByTestId('business-public-profile-preview')).toContainText('Restoration');
  await page.getByTestId('business-additional-services').fill('Lighting, Ceiling fans');
  await expect(page.getByTestId('business-public-profile-preview')).toContainText('Lighting');

  await expect(page.getByRole('button', { name: 'Save & Continue' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await expect(page.getByTestId('marketing-brand-kit-tab')).toBeVisible();
});

test('capture Business Information reference implementation', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  const screenshotDir = path.resolve('../docs/audit-screenshots/marketing');
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/marketing?tab=profile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('public-presence-profile-tab')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-business-information-reference-implementation.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('business-public-profile-preview')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-business-information-reference-mobile.png'), fullPage: true });
});

test('Brand Kit provides guided controls, a live preview, and saves before continuing', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  await page.goto('/app/marketing?tab=brand', { waitUntil: 'domcontentloaded' });

  const step = page.getByTestId('marketing-brand-kit-tab');
  await expect(step).toBeVisible();
  await expect(step).toContainText("Let's get to know your brand");
  await expect(step).toContainText('Do you already have a logo?');
  await expect(step).toContainText('Do you have colors in mind?');
  await expect(step).toContainText('How should customers describe your business?');
  await expect(step).toContainText('What should customers feel when they visit?');
  await expect(step).toContainText('Colors');
  await expect(step).toContainText('Website Appearance');
  await expect(step).toContainText('Website Text Style');
  await expect(step).toContainText('Writing Style & Tagline');
  await expect(step).toContainText('Website Cover Photo');
  await expect(step).not.toContainText('Step 2 of 8');
  await expect(step).not.toContainText('Project Assistant is not configured yet');
  await expect(page.getByTestId('online-presence-leads-handoff')).toHaveCount(0);
  await expect(page.getByTestId('brand-preview')).toContainText('Bright Build Co');
  await expect(page.getByTestId('brand-preview')).toContainText('Preview only — save to apply these changes.');
  await expect(page.getByTestId('brand-preview')).not.toContainText('Choose a tone');

  const generate = page.getByTestId('generate-brand-kit');
  await expect(generate).toBeDisabled();
  await expect(page.getByTestId('brand-generation-readiness')).toContainText('Choose logo direction and color direction');
  const textLogo = page.getByRole('button', { name: 'Use business name' });
  await textLogo.focus();
  await page.keyboard.press('Space');
  await expect(textLogo).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Choose colors' }).click();
  await page.getByRole('button', { name: 'Use mine' }).click();
  await page.getByRole('button', { name: 'Professional & dependable' }).click();
  await page.getByRole('button', { name: 'Confident' }).click();
  await expect(generate).toBeEnabled();
  await expect(page.getByTestId('brand-generation-readiness')).toContainText('Uses your selected preferences');
  await expect(page.getByRole('button', { name: 'Professional & dependable' })).toHaveAttribute('aria-pressed', 'true');
  const sectionOrder = await step.locator('.grid.md\\:grid-cols-2').first().evaluate((grid) => [...grid.children].map((node) => ({ label: node.querySelector('.font-black')?.textContent, order: Number(getComputedStyle(node).order) })).sort((a, b) => a.order - b.order).map((item) => item.label));
  expect(sectionOrder).toEqual(['Logo', 'Colors', 'Website Appearance', 'Writing Style & Tagline', 'Website Cover Photo']);
  await expect(step.getByText('Background Style')).toBeVisible();
  await expect(step.getByText('Preview-only until website theme support is enabled.')).toBeVisible();

  await page.getByTestId('brand-kit-primary-color').fill('#123456');
  await expect(page.getByTestId('brand-preview').locator('[style*="rgb(18, 52, 86)"]')).toHaveCount(1);
  await page.getByTestId('brand-kit-tagline').fill('Built with care.');
  await expect(page.getByTestId('brand-preview')).toContainText('Built with care.');
  await expect(page.getByRole('button', { name: 'Save & Continue' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await expect(page.getByTestId('public-presence-gallery-tab')).toBeVisible();
});

test('capture final Brand Kit implementation', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  const screenshotDir = path.resolve('../docs/audit-screenshots/marketing');
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/marketing?tab=brand', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('marketing-brand-kit-tab')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const aboveFold = await page.getByTestId('marketing-brand-kit-tab').evaluate((root) => {
    const logo = [...root.querySelectorAll('div')].find((node) => node.textContent === 'Logo');
    const colors = [...root.querySelectorAll('div')].find((node) => node.textContent === 'Colors');
    const appearance = [...root.querySelectorAll('div')].find((node) => node.textContent === 'Website Appearance');
    return { logoTop: logo?.getBoundingClientRect().top || 9999, colorsTop: colors?.getBoundingClientRect().top || 9999, appearanceTop: appearance?.getBoundingClientRect().top || 9999 };
  });
  expect(aboveFold.logoTop).toBeLessThan(1000);
  expect(aboveFold.colorsTop).toBeLessThan(1000);
  expect(aboveFold.appearanceTop).toBeLessThan(1000);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-brand-kit-final-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('brand-preview')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-brand-kit-final-mobile.png'), fullPage: true });
});

test('Portfolio is an image-led gallery with a contained project workflow', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  await page.goto('/app/marketing?tab=gallery', { waitUntil: 'domcontentloaded' });
  const step = page.getByTestId('public-presence-gallery-tab');
  await expect(step).toBeVisible();
  await expect(step).toContainText('Showcase your best work to build trust and win more business.');
  await expect(step).not.toContainText('Step 3 of 8');
  await expect(step).not.toContainText('Hero Image');
  await expect(step).not.toContainText('Your Progress');
  await expect(page.getByTestId('online-presence-leads-handoff')).toHaveCount(0);
  await expect(page.getByTestId('portfolio-summary')).toContainText('Public Items');
  await expect(page.getByTestId('portfolio-gallery')).toContainText('Kitchen update');
  await expect(page.getByTestId('portfolio-gallery')).toContainText('Kitchen remodel');
  await expect(page.getByTestId('portfolio-gallery')).toContainText('Featured');
  await expect(page.getByTestId('portfolio-gallery')).toContainText('Public');
  await expect(page.getByTestId('portfolio-gallery')).toContainText('No photo available');
  await expect(page.getByTestId('portfolio-gallery').getByRole('img', { name: 'No photo available' })).toBeVisible();
  await expect(page.getByTestId('portfolio-gallery').getByRole('button', { name: /Remove/ })).not.toBeVisible();
  await page.getByLabel('More actions for Kitchen update').click();
  await expect(page.getByTestId('portfolio-gallery').getByRole('button', { name: 'Remove Kitchen update' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('portfolio-gallery').getByRole('button', { name: 'Remove Kitchen update' }).click();
  await expect(page.getByTestId('portfolio-gallery')).toContainText('Kitchen update');
  await expect(step).toContainText('Add more work to strengthen your portfolio.');
  await page.getByRole('button', { name: 'Hidden 0' }).click();
  await expect(page.getByTestId('portfolio-filter-empty')).toContainText('No hidden portfolio items yet.');

  await page.getByTestId('portfolio-add-project').click();
  const editor = page.getByTestId('portfolio-project-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Suggest Title');
  await expect(editor).toContainText('Suggest Project Type');
  await expect(editor).toContainText('Improve Description');
  await editor.getByTestId('gallery-title-input').fill('Bathroom refresh');
  await editor.getByTestId('gallery-category-input').fill('Bathroom remodel');
  await editor.getByTestId('gallery-caption-input').fill('Updated fixtures and tile.');
  await expect(page.getByTestId('public-presence-gallery-tab')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save & Continue' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await expect(page.getByTestId('public-presence-reviews-tab')).toBeVisible();
});

test('capture final Portfolio implementation', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });
  const screenshotDir = path.resolve('../docs/audit-screenshots/marketing');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/marketing?tab=gallery', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('portfolio-gallery')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-portfolio-final-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('portfolio-gallery')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-portfolio-final-mobile.png'), fullPage: true });
});

test('Marketing Overview renders the consolidated readiness workspace', async ({ page }) => {
  await mockMarketingPage(page, { pro: true, statusOverride: 'published' });

  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('marketing-overview-tab')).toBeVisible();
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Overview');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Brand Kit');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Portfolio');
  await expect(page.getByTestId('marketing-grouped-step-navigation')).toContainText('Build Your Foundation');
  await expect(page.getByTestId('marketing-grouped-step-navigation')).toContainText('Optimize & Publish');
  await expect(page.getByTestId('marketing-readiness')).toContainText('Marketing Readiness');
  await expect(page.getByTestId('marketing-readiness-list').locator('article').first()).toContainText('Highly Recommended');
  await expect(page.getByTestId('marketing-website-readiness')).toContainText('Website Readiness');
  await expect(page.getByTestId('marketing-inherited-company-facts')).toContainText('Inherited from Company Profile');
  await expect(page.getByTestId('marketing-inherited-company-facts')).toContainText('Edit Company Profile');
  await expect(page.getByTestId('marketing-assets')).toContainText('Completed');
  await expect(page.getByTestId('marketing-completed')).toContainText('QR code');
  await expect(page.getByTestId('marketing-website-snapshot')).not.toContainText('Preview image unavailable');
  await expect(page.getByTestId('marketing-quick-actions')).not.toContainText('Copy Public URL');
  await expect(page.getByTestId('marketing-quick-actions')).not.toContainText('Open Public Profile');
  await expect(page.getByTestId('marketing-overview-tab')).not.toContainText('Leads');
  await expect(page.getByTestId('marketing-overview-tab')).not.toContainText('Public Overrides');
  await expect(page.getByTestId('marketing-advisor-panel')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Preview Website' })).toHaveCount(1);
  await expect(page.getByTestId('online-presence-setup-shell').getByRole('button', { name: 'Project Assistant' })).toHaveCount(0);

  await page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Brand Kit/ }).click();
  await expect(page.getByTestId('marketing-brand-kit-tab')).toContainText('Used across your website');
  await expect(page.getByTestId('marketing-brand-kit-tab')).toContainText('public profile');

  await page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Portfolio/ }).click();
  await expect(page.getByTestId('public-presence-gallery-tab')).toContainText('Portfolio');
  await expect(page.getByTestId('public-presence-gallery-tab')).toContainText('Showcase your best work');
});

test('capture Marketing Overview reference implementation', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true, statusOverride: 'draft' });
  const screenshotDir = path.resolve('../docs/audit-screenshots/marketing');
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('marketing-overview-tab')).toBeVisible();
  await expect(page.getByTestId('marketing-readiness-list').locator('article').first()).toContainText('Required');
  await expect(page.getByTestId('marketing-overview-tab')).not.toContainText('Leads');
  await expect(page.getByTestId('marketing-website-readiness')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-overview-refined-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('marketing-readiness-list').locator('article')).toHaveCount(5);
  await expect(page.getByTestId('marketing-completed')).toContainText('QR code');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(screenshotDir, 'marketing-overview-refined-mobile.png'), fullPage: true });
});

test('Marketing Project Assistant hooks show review-before-apply suggestions', async ({ page }) => {
  await mockMarketingPage(page, { pro: false, developmentOverride: true });

  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });

  const setupNav = page.getByTestId('online-presence-setup-nav');

  await setupNav.getByRole('button', { name: /Business Information/ }).click();
  await page.getByTestId('ai-generate-business-description').click();
  await expect(page.getByTestId('ai-suggestion-business-description')).toContainText('Bright Build Co delivers clean Austin remodels');
  await page.getByTestId('ai-accept-business-description').click();
  await expect(page.getByTestId('business-description-input')).toHaveValue(/Bright Build Co delivers clean Austin remodels/);

  await setupNav.getByRole('button', { name: /Portfolio/ }).click();
  await page.getByTestId('portfolio-add-project').click();
  await page.getByTestId('ai-photo-title').click();
  await page.getByTestId('ai-accept-photo-title').click();
  await expect(page.getByTestId('gallery-title-input')).toHaveValue('Finished kitchen remodel');
  await page.getByTestId('ai-photo-caption').click();
  await page.getByTestId('ai-accept-photo-caption').click();
  await expect(page.getByTestId('gallery-caption-input')).toHaveValue(/bright kitchen update/);
  await page.getByTestId('ai-photo-category').click();
  await page.getByTestId('ai-accept-photo-category').click();
  await expect(page.getByTestId('gallery-category-input')).toHaveValue('Kitchen remodel');
  await page.getByTestId('portfolio-project-editor').getByRole('button', { name: 'Close' }).click();

  await setupNav.getByRole('button', { name: /Design & Content/ }).click();
  await page.getByTestId('ai-hero-headline').click();
  await expect(page.getByTestId('website-builder-hero-headline')).not.toHaveValue('Austin remodeling without project chaos');
  await page.getByTestId('ai-accept-hero-headline').click();
  await expect(page.getByTestId('website-builder-hero-headline')).toHaveValue('Austin remodeling without project chaos');
  await page.getByTestId('ai-hero-subheadline').click();
  await page.getByTestId('ai-accept-hero-subheadline').click();
  await expect(page.getByTestId('website-builder-hero-subheadline')).toHaveValue(/Premium remodeling/);

  await setupNav.getByRole('button', { name: /SEO & Visibility/ }).click();
  await page.getByTestId('ai-seo-title').click();
  await page.getByTestId('ai-accept-seo-title').click();
  await expect(page.getByTestId('seo-title-input')).toHaveValue('Bright Build Co | Austin Remodeling Contractor');
  await page.getByTestId('ai-seo-description').click();
  await page.getByTestId('ai-accept-seo-description').click();
  await expect(page.getByTestId('seo-description-input')).toHaveValue(/Austin remodeling contractor/);
  await page.getByTestId('ai-seo-keywords').click();
  await page.getByTestId('ai-accept-seo-keywords').click();
  await expect(page.getByTestId('seo-keywords-input')).toHaveValue(/Austin remodeling/);

  await setupNav.getByRole('button', { name: /Final Review/ }).click();
  await expect(page.getByTestId('website-preview-summary-card')).toBeVisible();
  await expect(page.getByTestId('online-presence-final-review-tab').getByTestId('public-website-renderer')).toHaveCount(0);
  await expect(page.getByTestId('final-preview-desktop')).toHaveAttribute('href', /\/app\/marketing\/preview\?mode=desktop$/);
  await expect(page.getByTestId('final-preview-mobile')).toHaveAttribute('href', /\/app\/marketing\/preview\?mode=mobile$/);
  await expect(page.getByTestId('ai-website-audit-card')).toContainText('Project Assistant Website Audit');
  await page.getByTestId('ai-final-review-suggestions').click();
  await expect(page.getByTestId('ai-suggestion-final-website-audit')).toContainText('ready to publish');
});

test('Pro contractor can edit Design & Content, open full preview, and publish a snapshot', async ({ page }) => {
  await mockMarketingPage(page, { pro: true });

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('website-builder-hero-headline').fill('Premium remodeling, handled clearly');
  await page.getByTestId('website-builder-save-page').click();
  await expect(page.getByText('Website page saved.')).toBeVisible();
  await expect(page.getByTestId('website-builder-hero-headline')).toHaveValue('Premium remodeling, handled clearly');

  await page.goto('/app/marketing/preview?mode=mobile', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('full-preview-mobile-frame')).toBeVisible();
  await expect(page.getByTestId('public-website-renderer')).toContainText('Premium remodeling, handled clearly');

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Publish/ }).click();
  await page.getByTestId('website-builder-publish-button').click();
  await expect(page.getByText('Website published.', { exact: true })).toBeVisible();

  await page.goto('/websites/bright-build-co', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('public-website-page')).toBeVisible();
  await expect(page.getByTestId('public-website-renderer')).toContainText('Premium remodeling, handled clearly');
  await expect(page.getByTestId('public-website-intake-form')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a Project' }).first()).toBeVisible();
  await expect(page.getByTestId('public-website-intake-form')).toContainText('Start a Project');
  await page.getByRole('link', { name: 'Start a Project' }).first().click();
  await page.getByPlaceholder('Full name').fill('Jordan Website');
  await page.getByPlaceholder('you@example.com').fill('jordan@example.com');
  await page.getByPlaceholder('Kitchen remodel, repair, etc.').fill('Kitchen remodel');
  await page.getByPlaceholder('Tell us what you want done and any important details.').fill('We need cabinets, counters, and lighting.');
  await page.getByLabel(/I agree/).check();
  await page.getByTestId('public-website-intake-submit').click();
  await expect(page.getByTestId('public-website-intake-message')).toContainText('Your request was sent to Bright Build Co.');
});
