import { expect, test } from '@playwright/test';

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

function makeWebsitePayload({ pro = false, published = false } = {}) {
  const status = published ? 'published' : 'draft';
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
      plan: pro ? 'pro' : 'free',
      features: {
        public_profile: { key: 'public_profile', enabled: true, tier: 'free', label: 'Free public profile' },
        website_builder: {
          key: 'website_builder',
          enabled: pro,
          tier: 'pro',
          label: 'Website Builder',
          reason: pro ? '' : 'Upgrade to Pro to customize a multi-section website.',
        },
        website_publish: {
          key: 'website_publish',
          enabled: pro,
          tier: 'pro',
          label: 'Publish website',
          reason: pro ? '' : 'Publishing is part of the Pro Website Builder.',
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
    publish_blockers: pro ? [] : ['Publishing is part of the Pro Website Builder.'],
    recommended_next_steps: pro
      ? []
      : [{ key: 'tagline', label: 'Add a tagline', action: 'Summarize what you do in one short line.' }],
  };
}

async function mockMarketingPage(page, { pro = false } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let websitePayload = makeWebsitePayload({ pro });
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
            image_url: '',
            description: 'Clean finish work',
            is_public: true,
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

  await page.route(/\/api\/projects\/(?:contractor\/public-leads|contractor-opportunities)\/?$/, async (route) => {
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
    if (!pro) {
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
}

test('Marketing Website Builder tab loads readiness data and keeps Free contractors gated', async ({ page }) => {
  await mockMarketingPage(page, { pro: false });

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('marketing-website-builder-tab')).toBeVisible();
  await expect(page.getByTestId('website-builder-step-nav')).toContainText('78%');
  await expect(page.getByTestId('website-builder-basics-step')).toContainText('Business Basics');
  await expect(page.getByTestId('website-builder-live-preview')).toContainText('Bright Build Co');

  await page.getByRole('button', { name: 'Branding' }).click();
  await expect(page.getByTestId('website-builder-branding-step')).toContainText('Upgrade to Pro');
  await expect(page.getByTestId('wizard-primary-color')).toBeEnabled();
  await page.getByTestId('wizard-primary-color').fill('#0f766e');
  await expect(page.getByTestId('website-builder-live-preview')).toBeVisible();

  await page.getByRole('button', { name: 'Preview & Publish' }).click();
  await expect(page.getByTestId('website-builder-readiness-checklist')).toContainText('Add a tagline');
  await expect(page.getByTestId('website-builder-publish-button')).toBeDisabled();
});

test('Pro contractor can use wizard steps, edit services, preview mobile, and publish a snapshot', async ({ page }) => {
  await mockMarketingPage(page, { pro: true });

  await page.goto('/app/marketing?tab=website', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('wizard-tagline').fill('Premium remodeling, handled clearly');
  await expect(page.getByTestId('website-builder-live-preview')).toContainText('Premium remodeling, handled clearly');

  await page.getByRole('button', { name: 'Branding' }).click();
  await page.getByRole('button', { name: 'Premium Home' }).click();
  await expect(page.getByTestId('website-builder-branding-step')).toContainText('Premium Home');

  await page.getByRole('button', { name: 'Services' }).click();
  await page.getByPlaceholder('Service 1').fill('Custom kitchens');
  await page.getByPlaceholder('Short description').first().fill('Careful kitchen remodels with clear scopes.');
  await page.getByRole('button', { name: 'Save Service Cards' }).click();
  await expect(page.getByText('Website page saved.')).toBeVisible();
  await expect(page.getByTestId('website-builder-live-preview')).toContainText('Custom kitchens');

  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByTestId('website-builder-portfolio-step')).toContainText('Kitchen update');

  await page.getByRole('button', { name: 'Mobile' }).click();
  await expect(page.getByTestId('public-website-renderer')).toBeVisible();

  await page.getByRole('button', { name: 'Preview & Publish' }).click();
  await page.getByTestId('website-builder-publish-button').click();
  await expect(page.getByText('Website published.')).toBeVisible();

  await page.goto('/websites/bright-build-co', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('public-website-page')).toBeVisible();
  await expect(page.getByTestId('public-website-renderer')).toContainText('Custom kitchens');
});
