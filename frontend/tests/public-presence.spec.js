import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/projects\/contractor\/website\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlements: {
          plan: 'free',
          features: {
            public_profile: { key: 'public_profile', enabled: true, tier: 'free', label: 'Free public profile' },
            website_builder: {
              key: 'website_builder',
              enabled: false,
              tier: 'pro',
              label: 'Website Builder',
              reason: 'Upgrade to Pro to customize a multi-section website.',
            },
            website_publish: {
              key: 'website_publish',
              enabled: false,
              tier: 'pro',
              label: 'Publish website',
              reason: 'Publishing is part of the Pro Website Builder.',
            },
          },
        },
        profile: {
          identity: { business_name: 'Bright Build Co' },
          gallery: { count: 0, items: [] },
          reviews: { count: 0, selected: [] },
        },
        readiness: {
          score: 67,
          complete_count: 6,
          total_count: 9,
          missing_required_fields: ['tagline'],
          checklist: [
            { key: 'business_name', label: 'Add public business name', complete: true, required: true },
            { key: 'tagline', label: 'Add a tagline', complete: false, required: true, action: 'Summarize what you do in one short line.' },
          ],
        },
        draft: { status: 'placeholder', has_draft: false },
        recommended_next_steps: [
          { key: 'tagline', label: 'Add a tagline', action: 'Summarize what you do in one short line.' },
        ],
      }),
    });
  });
});

test('contractor can manage public presence and see qr data', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const state = {
    profile: {
      slug: 'bright-build-co',
      business_name_public: 'Bright Build Co',
      tagline: 'Trusted renovations and repairs',
      bio: 'We help homeowners with clean, reliable project delivery.',
      owner_contact_name: 'Morgan Builder',
      primary_trade: 'Remodeling',
      service_area_mode: 'radius',
      service_cities: ['Austin'],
      service_counties: ['Travis County'],
      credentials: {
        licensed: true,
        insured: true,
        residential: true,
        license_number: 'TX-123',
      },
      customer_trust_badges: ['Locally owned'],
      has_existing_website: false,
      existing_website_url: '',
      website_analysis_status: 'not_started',
      proposal_tone: 'friendly',
      preferred_signoff: 'Best, Bright Build Co',
      brand_primary_color: '#2563eb',
      city: 'Austin',
      state: 'TX',
      service_area_text: 'Austin metro',
      years_in_business: 12,
      website_url: 'https://bright.example.com',
      phone_public: '555-111-2222',
      email_public: 'hello@bright.example.com',
      specialties: ['Roofing'],
      work_types: ['Repairs'],
      show_license_public: true,
      show_phone_public: true,
      show_email_public: false,
      allow_public_intake: true,
      allow_public_reviews: true,
      is_public: true,
      compatibility_profile: {
        tier: 'Strong Match',
        summary: 'Good fit for collaborative projects and homeowner participation.',
        badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
        ways_i_work: [
          { key: 'assisted_diy', label: 'DIY Assistance Available', description: 'Guided DIY assistance available.' },
          { key: 'consultation', label: 'Consultation Available', description: 'Advice, planning, and guidance are available.' },
        ],
        reasons: ['Comfortable working alongside homeowners.', 'Accepts escrow milestone payments.'],
      },
      compatibility_badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
      ways_i_work: [
        { key: 'assisted_diy', label: 'DIY Assistance Available', description: 'Guided DIY assistance available.' },
        { key: 'consultation', label: 'Consultation Available', description: 'Advice, planning, and guidance are available.' },
      ],
      seo_title: '',
      seo_description: '',
      public_url: 'http://localhost:4173/contractors/bright-build-co',
      logo_url: '',
      cover_image_url: '',
    },
    qr: {
      slug: 'bright-build-co',
      public_url: 'http://localhost:4173/contractors/bright-build-co',
      qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
      download_filename: 'bright-build-co-public-profile-qr.svg',
    },
    gallery: [],
    reviews: [
      {
        id: 1,
        customer_name: 'Taylor Homeowner',
        rating: 5,
        title: 'Excellent work',
        review_text: 'Professional from start to finish.',
        is_verified: true,
        is_public: true,
        submitted_at: '2026-03-25T10:00:00Z',
      },
      {
        id: 2,
        customer_name: 'Jordan Client',
        rating: 4,
        title: 'Pending review',
        review_text: 'Waiting for moderation.',
        is_verified: false,
        is_public: false,
        submitted_at: '2026-03-25T12:00:00Z',
      },
    ],
    profilePatchCount: 0,
    leads: [
      {
        id: 11,
        source: 'public_profile',
        full_name: 'Casey Prospect',
        email: 'casey@example.com',
        phone: '555-444-3333',
        project_address: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip_code: '78701',
        project_type: 'Kitchen Remodel',
        project_description: 'Need a remodel estimate.',
        preferred_timeline: 'ASAP',
        budget_text: '$25k-$40k',
        status: 'new',
        internal_notes: '',
        accepted_at: null,
        ai_analysis: {},
        matching: {
          tier: 'Strong Match',
          score: 86,
          summary: 'Strong fit for this project and working style.',
          badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
          reasons: ['Offers Assisted DIY support.', 'Accepts escrow milestone payments.'],
        },
        created_at: '2026-03-25T11:00:00Z',
        converted_homeowner_id: null,
        converted_homeowner_name: '',
        converted_agreement: null,
        converted_at: null,
      },
    ],
  };

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
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route(/public-profile\/?$/, async (route) => {
    if (route.request().method() === 'PATCH') {
      state.profilePatchCount += 1;
      if (state.profilePatchCount === 1) {
        state.profile.has_existing_website = true;
        state.profile.existing_website_url = 'https://bright.example.com';
        state.profile.website_analysis_status = 'not_started';
      } else if (state.profilePatchCount === 2) {
        state.profile.business_name_public = 'Bright Build Renovations';
        state.profile.years_in_business = 14;
        state.profile.primary_trade = 'Kitchen remodeling';
        state.profile.service_area_mode = 'cities';
        state.profile.service_cities = ['Austin', 'Round Rock'];
        state.profile.service_counties = ['Travis County', 'Williamson County'];
        state.profile.credentials = {
          licensed: true,
          insured: true,
          bonded: true,
          residential: true,
          commercial: true,
          license_number: 'TX-999',
        };
        state.profile.customer_trust_badges = ['Locally owned', 'Warranty included'];
      } else {
        state.profile.has_existing_website = false;
        state.profile.existing_website_url = '';
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.profile),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.profile),
    });
  });

  await page.route('**/api/projects/contractors/generate-profile/', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tagline: 'Premium remodeling with clear communication',
        intro: `We turn your vision into a calm, well-managed project. ${body.prompt || ''}`.trim(),
        tone: 'premium',
        work_types: ['Kitchen Remodels', 'Bathroom Remodels', 'Whole Home Renovations'],
        seo_title: 'Bright Build Co | Austin Remodeling Contractor',
        seo_description:
          'Bright Build Co helps Austin homeowners with premium remodeling, renovations, and careful project management.',
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/public-profile\/qr\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.qr),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    if (route.request().method() === 'POST') {
      state.gallery = [
        {
          id: 51,
          title: 'Kitchen Remodel',
          category: 'Remodel',
          image_url: 'http://localhost:4173/media/kitchen.jpg',
          is_public: true,
          sort_order: 0,
        },
      ];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(state.gallery[0]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.gallery }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.reviews }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/reviews\/\d+\/$/, async (route) => {
    const id = Number(route.request().url().match(/reviews\/(\d+)\//)?.[1]);
    const body = route.request().postDataJSON();
    state.reviews = state.reviews.map((review) =>
      review.id === id ? { ...review, ...body } : review
    );
    const updated = state.reviews.find((review) => review.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(/\/api\/projects\/(?:contractor\/public-leads|contractor-opportunities)\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.leads }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\//)?.[1]);
    const body = route.request().postDataJSON();
    state.leads = state.leads.map((lead) => (lead.id === id ? { ...lead, ...body } : lead));
    const updated = state.leads.find((lead) => lead.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/accept\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/accept\//)?.[1]);
    state.leads = state.leads.map((lead) =>
      lead.id === id
        ? {
            ...lead,
            status: 'accepted',
            accepted_at: '2026-03-25T12:00:00Z',
            converted_homeowner_id: 201,
            converted_homeowner_name: lead.full_name,
            converted_at: '2026-03-25T12:00:00Z',
          }
        : lead
    );
    const updated = state.leads.find((lead) => lead.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/analyze\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/analyze\//)?.[1]);
    const aiAnalysis = {
      project_type: 'Remodel',
      project_subtype: 'Kitchen Remodel',
      suggested_title: 'Kitchen Remodel - Casey Prospect',
      suggested_description: 'AI suggested remodel draft from public intake.',
      clarifications_needed: [{ key: 'materials', label: 'Who supplies materials?' }],
      milestone_outline: [{ order: 1, title: 'Preparation' }, { order: 2, title: 'Core Work' }],
      recommended_templates: [{ id: 501, name: 'Kitchen Remodel Template' }],
      template_id: 501,
      template_name: 'Kitchen Remodel Template',
    };
    state.leads = state.leads.map((lead) =>
      lead.id === id ? { ...lead, ai_analysis: aiAnalysis } : lead
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lead_id: id, ai_analysis: aiAnalysis }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/create-agreement\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/create-agreement\//)?.[1]);
    state.leads = state.leads.map((lead) =>
      lead.id === id ? { ...lead, converted_agreement: 901 } : lead
    );
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: 901,
        detail_url: '/app/agreements/901',
        wizard_url: '/app/agreements/901/wizard?step=1',
        created: true,
      }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/convert-homeowner\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/convert-homeowner\//)?.[1]);
    state.leads = state.leads.map((lead) =>
      lead.id === id
        ? {
            ...lead,
            status: lead.status === 'new' ? 'qualified' : lead.status,
            converted_homeowner_id: 201,
            converted_homeowner_name: lead.full_name,
            converted_at: '2026-03-25T12:30:00Z',
          }
        : lead
    );
    const updated = state.leads.find((lead) => lead.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('public-presence-title')).toBeVisible();
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Online Presence Setup');
  await expect(page.getByTestId('online-presence-readiness-score')).toContainText('67%');
  await expect(page.getByTestId('website-decision-step')).toContainText(
    "Let's start with your website."
  );
  await expect(page.getByTestId('website-decision-no-website')).toContainText(
    "I don't have a website"
  );
  await expect(page.getByTestId('website-decision-existing-website')).toContainText(
    'I already have a website'
  );
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Design & Content');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('SEO & Visibility');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Final Review');
  await expect(page.getByTestId('online-presence-setup-nav')).toContainText('Publish');
  const setupLayout = await page.getByTestId('online-presence-setup-nav').evaluate((nav) => ({
    navWidth: nav.getBoundingClientRect().width,
    documentFits: document.documentElement.scrollWidth <= window.innerWidth + 2,
  }));
  expect(setupLayout.navWidth).toBeGreaterThan(520);
  expect(setupLayout.documentFits).toBeTruthy();
  await expect(page.getByTestId('public-presence-preview-banner')).toHaveCount(0);

  await page.getByTestId('existing-website-url-input').fill('not-a-site');
  await page.getByTestId('website-decision-continue').click();
  await expect(page.getByTestId('existing-website-url-error')).toContainText(
    'Enter a valid website address'
  );
  await page.getByTestId('existing-website-url-input').fill('bright.example.com');
  await expect(page.getByTestId('existing-website-coming-soon-card')).toContainText('Coming Soon');
  await expect(page.getByTestId('existing-website-coming-soon-card')).toContainText('Analyze your website');
  await page.getByTestId('website-decision-continue').click();
  await expect(page.getByRole('heading', { name: 'Business Information' })).toBeVisible();
  await expect(state.profile.has_existing_website).toBeTruthy();
  expect(state.profile.existing_website_url).toBe('https://bright.example.com');

  await expect(page.getByRole('heading', { name: 'Business Information' })).toBeVisible();
  await expect(page.getByText('We imported this from your MyHomeBro profile.')).toBeVisible();
  await expect(page.getByText('Company / business name')).toBeVisible();
  await expect(page.getByText('Owner / contact name')).toBeVisible();
  await expect(page.getByText('Primary trade')).toBeVisible();
  await expect(page.getByText('Additional trades/services')).toBeVisible();
  await expect(page.getByText('Why customers choose you')).toBeVisible();
  await expect(page.locator('input[value="Bright Build Co"]').first()).toBeVisible();
  await expect(page.locator('input[value="Morgan Builder"]').first()).toBeVisible();
  await expect(page.locator('input[value="Remodeling"]').first()).toBeVisible();
  await expect(page.getByTestId('proposal-tone-selector')).toHaveCount(0);
  await expect(page.getByTestId('brand-primary-color-input')).toHaveCount(0);
  await expect(page.getByTestId('brand-font-theme-select')).toHaveCount(0);
  await expect(page.getByText('Theme preset')).toHaveCount(0);
  await expect(page.getByTestId('public-presence-qr-image')).toBeVisible();
  await page.getByLabel('Company / business name').fill('Bright Build Renovations');
  await page.getByLabel('Years in business').fill('14');
  await page.getByLabel('Primary trade').fill('Kitchen remodeling');
  await page.getByLabel('Additional trades/services').fill('Electrical repair, generator installation');
  await page.getByLabel('Business type').fill('Residential, commercial');
  await page.getByRole('button', { name: 'Warranty included' }).click();
  await page.getByTestId('public-presence-save-profile').click();
  await expect(page.locator('input[value="Bright Build Renovations"]').first()).toBeVisible();
  await expect(page.locator('input[value="Kitchen remodeling"]').first()).toBeVisible();

  await page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Website Decision/ }).click();
  await page.getByTestId('website-decision-no-website').click();
  await page.getByTestId('website-decision-continue').click();
  await expect(page.getByRole('heading', { name: 'Business Information' })).toBeVisible();
  await expect(state.profile.has_existing_website).toBeFalsy();

  await page.getByRole('button', { name: 'Photo Gallery' }).click();
  await page.getByPlaceholder('Title').fill('Kitchen Remodel');
  await page.getByTestId('gallery-image-input').setInputFiles({
    name: 'kitchen.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fake-image'),
  });
  await page.getByRole('button', { name: 'Add Gallery Item' }).click();
  await expect(page.getByTestId('public-presence-gallery-tab')).toContainText('Kitchen Remodel');

  await expect(page.getByTestId('public-presence-gallery-tab')).toContainText('Bright Build Renovations');

  await page.getByRole('button', { name: 'Reviews & Testimonials' }).click();
  await expect(page.getByRole('heading', { name: 'Reviews & Testimonials' })).toBeVisible();
  await expect(page.getByTestId('public-presence-reviews-tab')).toContainText('Taylor Homeowner');
  await expect(page.getByTestId('public-presence-reviews-tab')).toContainText('Pending moderation');
  await page.getByRole('button', { name: 'Publish Review' }).click();
  await expect(page.getByTestId('public-presence-reviews-tab')).toContainText('Public');

  await page.getByRole('button', { name: 'Design & Content' }).click();
  await expect(page.getByRole('heading', { name: 'Design & Content' })).toBeVisible();
  await expect(page.getByTestId('marketing-website-builder-tab')).toBeVisible();

  await page.getByRole('button', { name: 'SEO & Visibility' }).click();
  await expect(page.getByRole('heading', { name: 'SEO & Visibility' })).toBeVisible();

  await page.getByRole('button', { name: 'Final Review' }).click();
  await expect(page.getByRole('heading', { name: 'Final Review' })).toBeVisible();

  await page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Publish/ }).click();
  await expect(page.getByTestId('online-presence-publish-tab')).toContainText('Ready to Publish');

  await page.getByRole('button', { name: 'Business Information' }).click();
  await expect(page.getByTestId('online-presence-leads-handoff')).toContainText(
    'Leads from your profile, QR code, and website appear in Opportunities.'
  );
  await expect(page.getByRole('button', { name: 'Website Leads' })).toHaveCount(0);
});

test('public contractor profile surfaces compatibility badges and ways I work', async ({ page }) => {
  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        website_url: 'https://bright.example.com',
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        show_license_public: true,
        show_phone_public: true,
        show_email_public: false,
        allow_public_intake: true,
        allow_public_reviews: true,
        is_public: true,
        compatibility_profile: {
          tier: 'Strong Match',
          summary: 'Good fit for collaborative projects and homeowner participation.',
          badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
          ways_i_work: [
            { key: 'assisted_diy', label: 'DIY Assistance Available', description: 'Guided DIY assistance available.' },
            { key: 'consultation', label: 'Consultation Available', description: 'Advice, planning, and guidance are available.' },
          ],
          reasons: ['Comfortable working alongside homeowners.', 'Accepts escrow milestone payments.'],
        },
        compatibility_badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
        ways_i_work: [
          { key: 'assisted_diy', label: 'DIY Assistance Available', description: 'Guided DIY assistance available.' },
          { key: 'consultation', label: 'Consultation Available', description: 'Advice, planning, and guidance are available.' },
        ],
        seo_title: '',
        seo_description: '',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        logo_url: '',
        cover_image_url: '',
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/rating/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        preview: false,
        average_rating: null,
        review_count: 0,
        new_on_myhomebro: true,
        display_label: 'New on MyHomeBro',
      }),
    });
  });

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('public-profile-compatibility')).toBeVisible();
  await expect(page.getByTestId('public-profile-compatibility')).toContainText('Ways I Work');
  await expect(page.getByTestId('public-profile-compatibility')).toContainText('DIY Assistance Available');
  await expect(page.getByTestId('public-profile-compatibility')).toContainText('Escrow Workflow Compatible');
  await expect(page.getByTestId('public-profile-compatibility')).toContainText('Good fit for collaborative projects');
});

test('landing-source intake and public-profile intake create leads handled in Opportunities', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const state = {
    profile: {
      slug: 'bright-build-co',
      business_name_public: 'Bright Build Co',
      tagline: 'Trusted renovations and repairs',
      bio: 'We help homeowners with clean, reliable project delivery.',
      city: 'Austin',
      state: 'TX',
      service_area_text: 'Austin metro',
      years_in_business: 12,
      website_url: 'https://bright.example.com',
      phone_public: '555-111-2222',
      email_public: 'hello@bright.example.com',
      specialties: ['Roofing'],
      work_types: ['Repairs'],
      show_license_public: true,
      show_phone_public: true,
      show_email_public: false,
      allow_public_intake: true,
      allow_public_reviews: true,
      is_public: true,
      compatibility_profile: {
        tier: 'Strong Match',
        summary: 'Good fit for collaborative projects and homeowner participation.',
        badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
        ways_i_work: [
          { key: 'assisted_diy', label: 'DIY Assistance Available', description: 'Guided DIY assistance available.' },
          { key: 'consultation', label: 'Consultation Available', description: 'Advice, planning, and guidance are available.' },
        ],
        reasons: ['Comfortable working alongside homeowners.', 'Accepts escrow milestone payments.'],
      },
      compatibility_badges: ['DIY Assistance Available', 'Escrow Workflow Compatible'],
      ways_i_work: [
        { key: 'assisted_diy', label: 'DIY Assistance Available', description: 'Guided DIY assistance available.' },
        { key: 'consultation', label: 'Consultation Available', description: 'Advice, planning, and guidance are available.' },
      ],
      seo_title: '',
      seo_description: '',
      public_url: 'http://localhost:4173/contractors/bright-build-co',
      logo_url: '',
      cover_image_url: '',
    },
    qr: {
      slug: 'bright-build-co',
      public_url: 'http://localhost:4173/contractors/bright-build-co',
      qr_target_url: 'http://localhost:4173/contractors/bright-build-co?source=qr',
      qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
      download_filename: 'bright-build-co-public-profile-qr.svg',
    },
    leads: [],
    nextLeadId: 100,
    nextAgreementId: 901,
  };

  const baseLead = {
    phone: '',
    project_address: '',
    city: '',
    state: '',
    zip_code: '',
    project_type: '',
    project_description: '',
    preferred_timeline: '',
    budget_text: '',
    status: 'new',
    internal_notes: '',
    accepted_at: null,
    ai_analysis: {},
    created_at: '2026-03-25T11:00:00Z',
    converted_homeowner_id: null,
    converted_homeowner_name: '',
    converted_agreement: null,
    converted_at: null,
  };

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
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route(/public-profile\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.profile),
    });
  });

  await page.route(/public-profile\/qr\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.qr),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/website/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlements: { plan: 'free', features: {} },
        website: { status: 'draft', template_key: 'starter', public_url: '/websites/bright-build-co', homepage_layout: {} },
        profile: {},
        readiness: { score: 75, checklist: [], missing_required_fields: [] },
        pages: [],
        draft: { status: 'draft', has_draft: true, template_key: 'starter' },
        publish_blockers: ['Publishing is part of the Pro Website Builder.'],
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/\/api\/projects\/(?:contractor\/public-leads|contractor-opportunities)\/?(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.leads }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/accept\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/accept\//)?.[1]);
    state.leads = state.leads.map((lead) =>
      lead.id === id
        ? {
            ...lead,
            status: 'accepted',
            accepted_at: '2026-03-25T12:00:00Z',
            converted_homeowner_id: 201,
            converted_homeowner_name: lead.full_name,
            converted_at: '2026-03-25T12:00:00Z',
          }
        : lead
    );
    const updated = state.leads.find((lead) => lead.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/analyze\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/analyze\//)?.[1]);
    const aiAnalysis = {
      project_type: 'Remodel',
      project_subtype: 'Kitchen Remodel',
      suggested_title: `Draft Agreement - ${id}`,
      suggested_description: 'Unified intake analysis result.',
      clarifications_needed: [],
      milestone_outline: [{ order: 1, title: 'Preparation' }],
      recommended_templates: [],
    };
    state.leads = state.leads.map((lead) =>
      lead.id === id ? { ...lead, ai_analysis: aiAnalysis } : lead
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lead_id: id, ai_analysis: aiAnalysis }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/create-agreement\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/create-agreement\//)?.[1]);
    const agreementId = state.nextAgreementId++;
    state.leads = state.leads.map((lead) =>
      lead.id === id ? { ...lead, converted_agreement: agreementId } : lead
    );
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: agreementId,
        detail_url: `/app/agreements/${agreementId}`,
        wizard_url: `/app/agreements/${agreementId}/wizard?step=1`,
        created: true,
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...state.profile,
        gallery: [],
        reviews: [],
        review_count: 0,
        average_rating: null,
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/intake/', async (route) => {
    const body = route.request().postDataJSON?.() || {};
    state.leads.unshift({
      id: state.nextLeadId++,
      ...baseLead,
      ...body,
      source: 'public_profile',
      created_at: '2026-03-25T11:00:00Z',
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Your project request was submitted.' }),
    });
  });

  await page.route(/.*\/api\/projects\/public-intake\/?.*/, async (route) => {
    const body = route.request().postDataJSON?.() || {};
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 501,
          token: 'landing-token',
          status: 'draft',
          contractor_name: 'Bright Build Co',
          customer_name: 'Landing Prospect',
          customer_email: 'landing@example.com',
          customer_phone: '555-333-2222',
          customer_address_line1: '',
          customer_address_line2: '',
          customer_city: '',
          customer_state: '',
          customer_postal_code: '',
          same_as_customer_address: true,
          project_address_line1: '',
          project_address_line2: '',
          project_city: '',
          project_state: '',
          project_postal_code: '',
          accomplishment_text: '',
          measurement_handling: '',
          ai_project_title: '',
          ai_project_type: '',
          ai_project_subtype: '',
          ai_description: '',
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          clarification_photos: [],
        }),
      });
      return;
    }

    state.leads.unshift({
      id: state.nextLeadId++,
      ...baseLead,
      source: 'landing_page',
      full_name: body.customer_name,
      email: body.customer_email,
      phone: body.customer_phone || '',
      project_address: body.project_address_line1,
      city: body.project_city,
      state: body.project_state,
      zip_code: body.project_postal_code,
      project_description: body.accomplishment_text,
      created_at: '2026-03-25T11:30:00Z',
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'Intake updated successfully.',
        id: 501,
        status: 'submitted',
        lead_id: state.leads[0].id,
        measurement_handling: body.measurement_handling || '',
        ai_clarification_answers: body.ai_clarification_answers || {},
        completed_at: '2026-03-25T11:35:00Z',
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Full name').fill('Profile Prospect');
  await page.getByPlaceholder('Email').fill('profile@example.com');
  await page.getByPlaceholder('Tell us about your project').fill('Public profile intake request.');
  await page.getByRole('button', { name: 'Submit Project Request' }).click();

  await page.goto('/start-project/landing-token', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('public-intake-accomplishment-text').fill(
    'Landing page intake request.'
  );
  await expect(page.getByTestId('public-intake-generate-structure')).toBeEnabled({ timeout: 10000 });
  await page.getByTestId('public-intake-generate-structure').click();
  await expect(page.getByTestId('public-intake-project-summary')).toBeVisible();
  await expect(page.getByTestId('public-intake-clarification-photo-section')).toBeVisible();
  await page.getByTestId('public-intake-clarification-next').click();
  await expect(page.getByTestId('public-intake-project-snapshot')).toBeVisible();
  await expect(page.getByTestId('public-intake-project-snapshot-title')).toContainText('Project Snapshot');
  await page.getByTestId('public-intake-project-snapshot-continue').click();
  await expect(page.getByTestId('public-intake-structured-output-step')).toBeVisible();
  await expect(page.getByTestId('public-intake-structured-output-title')).toContainText('Project Summary');
  await page.getByTestId('public-intake-structured-continue').click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('public-intake-customer-address-line1')).toBeVisible();
  await page.getByTestId('public-intake-customer-address-line1').fill('100 Landing Way');
  await page.getByTestId('public-intake-customer-city').fill('Austin');
  await page.getByTestId('public-intake-customer-state').fill('TX');
  await page.getByTestId('public-intake-customer-postal-code').fill('78701');
  await page.getByRole('button', { name: 'Review + Confirm' }).click();
  await page.getByTestId('public-intake-submit-button').click();

  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('online-presence-leads-handoff')).toContainText(
    'Leads from your profile, QR code, and website appear in Opportunities.'
  );
  await expect(page.getByRole('button', { name: 'Website Leads' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /View website leads in Opportunities/i })
  ).toHaveAttribute('href', '/app/opportunities?source=website');
  expect(state.leads.some((lead) => lead.full_name === 'Profile Prospect')).toBeTruthy();
  expect(state.leads.some((lead) => lead.full_name === 'Landing Prospect')).toBeTruthy();
  expect(state.leads.some((lead) => lead.source === 'public_profile')).toBeTruthy();
  expect(state.leads.some((lead) => lead.source === 'landing_page')).toBeTruthy();
});

test('public contractor profile renders gallery reviews and intake', async ({ page }) => {
  const reviewState = [
    {
      id: 1,
      customer_name: 'Taylor Homeowner',
      rating: 5,
      title: 'Excellent work',
      review_text: 'Professional from start to finish.',
      is_verified: true,
      submitted_at: '2026-03-25T10:00:00Z',
    },
  ];

  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        show_phone_public: true,
        show_email_public: true,
        show_license_public: true,
        allow_public_intake: true,
        allow_public_reviews: true,
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        review_count: 1,
        average_rating: 5,
        contractor_profile_insights: [
          'Frequently works on kitchen remodels and related cabinet scope.',
          'Usually keeps pricing aligned with similar projects.',
          'Typically keeps timelines steady and predictable for remodeling work.',
          'Uses a balanced milestone structure for remodel projects.',
          'Completed remodel projects show a steady, low-friction closeout pattern.',
        ],
        gallery: [
          {
            id: 51,
            title: 'Kitchen Remodel',
            description: 'Custom cabinets and finishes.',
            category: 'Remodel',
            image_url: 'http://localhost:4173/media/kitchen.jpg',
            project_city: 'Austin',
            project_state: 'TX',
          },
        ],
        reviews: reviewState,
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/reviews/', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: 'Thanks for your review. It will appear after moderation.',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: reviewState }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/intake/', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Your project request was submitted.' }),
    });
  });

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Bright Build Co' })).toBeVisible();
  await expect(page.getByText('Kitchen Remodel', { exact: true })).toBeVisible();
  await expect(page.getByText('Taylor Homeowner')).toBeVisible();
  await expect(page.getByTestId('public-profile-contractor-insights')).toContainText('How this contractor works');
  await page.getByRole('button', { name: 'Leave Review' }).click();
  await expect(page.getByTestId('public-profile-review-modal')).toBeVisible();
  await page.getByLabel('Close modal').click();
  await page.getByRole('button', { name: 'Request a Quote' }).first().click();
  await expect(page.getByTestId('public-quote-request-wizard')).toBeVisible();
  await expect(page.getByTestId('public-quote-request-step-title')).toContainText('Project Basics');
});

test('public contractor profile applies saved branding and hides toggled sections', async ({ page }) => {
  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        show_phone_public: true,
        show_email_public: true,
        show_license_public: true,
        allow_public_intake: true,
        allow_public_reviews: true,
        is_public: true,
        brand_primary_color: '#1d4ed8',
        brand_accent_color: '#f97316',
        brand_font_theme: 'editorial_serif',
        profile_theme: 'warm',
        show_reviews: false,
        show_gallery: false,
        show_quote_cta: false,
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        logo_url: '',
        cover_image_url: '',
        hero_image_url: '',
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        review_count: 0,
        average_rating: null,
        contractor_profile_insights: [],
        public_trust_indicators: [],
        seo_title: '',
        seo_description: '',
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/rating/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        average_rating: null,
        review_count: 0,
        preview: false,
        new_on_myhomebro: true,
        display_label: 'New on MyHomeBro',
      }),
    });
  });

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });

  const rootStyle = await page.getByTestId('public-profile-root').getAttribute('style');
  expect(rootStyle).toContain('--mhb-public-primary: #1d4ed8');
  expect(rootStyle).toContain('--mhb-public-accent: #f97316');

  const fontFamily = await page.getByTestId('public-profile-root').evaluate((node) => getComputedStyle(node).fontFamily);
  expect(fontFamily).toContain('Georgia');

  await expect(page.getByTestId('public-profile-gallery-section')).toHaveCount(0);
  await expect(page.getByTestId('public-profile-reviews-section')).toHaveCount(0);
  await expect(page.getByTestId('public-profile-request-quote-cta')).toHaveCount(0);
});

test('legacy marketing lead links route back to setup with Opportunities handoff', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const state = {
    leads: [],
    nextLeadId: 900,
  };

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
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route(/public-profile\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        website_url: 'https://bright.example.com',
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        show_license_public: true,
        show_phone_public: true,
        show_email_public: false,
        allow_public_intake: true,
        allow_public_reviews: true,
        is_public: true,
        seo_title: '',
        seo_description: '',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        logo_url: '',
        cover_image_url: '',
      }),
    });
  });

  await page.route(/public-profile\/qr\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        qr_target_url: 'http://localhost:4173/contractors/bright-build-co?source=qr',
        qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
        download_filename: 'bright-build-co-public-profile-qr.svg',
      }),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/contractor/website/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entitlements: { plan: 'free', features: {} },
        website: { status: 'draft', template_key: 'starter', public_url: '/websites/bright-build-co', homepage_layout: {} },
        profile: {},
        readiness: { score: 75, checklist: [], missing_required_fields: [] },
        pages: [],
        draft: { status: 'draft', has_draft: true, template_key: 'starter' },
        publish_blockers: ['Publishing is part of the Pro Website Builder.'],
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route(/\/api\/projects\/(?:contractor\/public-leads|contractor-opportunities)\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const lead = {
        id: state.nextLeadId++,
        source: 'manual',
        full_name: body.full_name,
        email: body.email,
        phone: body.phone,
        project_address: body.project_address || '',
        city: '',
        state: '',
        zip_code: '',
        project_type: '',
        project_description: body.notes || '',
        preferred_timeline: '',
        budget_text: '',
        status: 'qualified',
        internal_notes: '',
        accepted_at: null,
        ai_analysis: {},
        source_intake_id: null,
        created_at: '2026-03-26T11:00:00Z',
        converted_homeowner_id: null,
        converted_homeowner_name: '',
        converted_agreement: null,
        converted_at: null,
      };
      state.leads = [lead, ...state.leads];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(lead),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: state.leads }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\//)?.[1]);
    const body = route.request().postDataJSON();
    state.leads = state.leads.map((lead) => (lead.id === id ? { ...lead, ...body } : lead));
    const updated = state.leads.find((lead) => lead.id === id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/\d+\/send-intake\/$/, async (route) => {
    const id = Number(route.request().url().match(/public-leads\/(\d+)\/send-intake\//)?.[1]);
    state.leads = state.leads.map((lead) =>
      lead.id === id
        ? {
            ...lead,
            status: 'pending_customer_response',
            source_intake_id: 801,
          }
        : lead
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        intake_id: 801,
        email: 'walkup@example.com',
        url: 'http://localhost:4173/start-project/manual-token',
        lead_id: id,
        lead_status: 'pending_customer_response',
        lead_source: 'manual',
      }),
    });
  });

  await page.route(/.*\/api\/projects\/intakes\/801\/$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 801,
        initiated_by: 'contractor',
        customer_name: 'Walk Up Prospect',
        customer_email: 'walkup@example.com',
        customer_phone: '555-666-0000',
        customer_address_line1: '400 Field Visit Rd',
        customer_address_line2: '',
        customer_city: 'Austin',
        customer_state: 'TX',
        customer_postal_code: '78706',
        same_as_customer_address: true,
        project_address_line1: '400 Field Visit Rd',
        project_address_line2: '',
        project_city: 'Austin',
        project_state: 'TX',
        project_postal_code: '78706',
        accomplishment_text: 'Convert the garage into a finished office and laundry room.',
        measurement_handling: '',
        ai_project_title: '',
        ai_project_type: '',
        ai_project_subtype: '',
        ai_description: '',
        ai_project_timeline_days: null,
        ai_project_budget: null,
        ai_milestones: [],
        ai_clarification_questions: [],
        ai_clarification_answers: {},
        clarification_photos: [],
        ai_analysis_payload: {},
      }),
    });
  });

  await page.route(/.*\/api\/projects\/public-intake\/?.*/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 801,
          token: 'manual-token',
          status: 'submitted',
          initiated_by: 'contractor',
          contractor_name: 'Bright Build Co',
          customer_name: 'Walk Up Prospect',
          customer_email: 'walkup@example.com',
          customer_phone: '555-666-0000',
          customer_address_line1: '',
          customer_address_line2: '',
          customer_city: '',
          customer_state: '',
          customer_postal_code: '',
          same_as_customer_address: true,
          project_address_line1: '',
          project_address_line2: '',
          project_city: '',
          project_state: '',
          project_postal_code: '',
          accomplishment_text: '',
          measurement_handling: '',
          ai_project_title: '',
          ai_project_type: '',
          ai_project_subtype: '',
          ai_description: '',
          ai_project_timeline_days: null,
          ai_project_budget: null,
          ai_milestones: [],
          ai_clarification_questions: [],
          ai_clarification_answers: {},
          clarification_photos: [],
          submitted_at: null,
          sent_at: '2026-03-26T11:10:00Z',
          completed_at: null,
        }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    state.leads = state.leads.map((lead) =>
      lead.id === 900
        ? {
            ...lead,
            source: 'manual',
            status: 'ready_for_review',
            project_description:
              'Convert the garage into a finished office and laundry room.',
            city: 'Austin',
            state: 'TX',
            zip_code: '78706',
          }
        : lead
    );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Intake updated successfully.',
          id: 801,
          status: 'submitted',
          lead_id: 900,
          measurement_handling: body.measurement_handling || '',
          ai_clarification_answers: body.ai_clarification_answers || {},
          completed_at: '2026-03-26T12:00:00Z',
        }),
      });
  });

  state.leads = [
    {
      id: 900,
      source: 'manual',
      full_name: 'Walk Up Prospect',
      email: 'walkup@example.com',
      phone: '5556660000',
      project_address: '400 Field Visit Rd',
      project_description: 'Garage conversion',
      status: 'pending_customer_response',
      source_intake_id: 801,
      created_at: '2026-03-26T11:00:00Z',
    },
  ];

  await page.goto('/start-project/manual-token', { waitUntil: 'domcontentloaded' });
  await page
    .getByTestId('public-intake-accomplishment-text')
    .fill('Convert the garage into a finished office and laundry room.');
  await expect(page.getByTestId('public-intake-generate-structure')).toBeEnabled({ timeout: 10000 });
  await page.getByTestId('public-intake-generate-structure').click();
  await page.getByTestId('public-intake-clarification-next').click();
  await expect(page.getByTestId('public-intake-project-snapshot')).toBeVisible();
  await page.getByTestId('public-intake-project-snapshot-continue').click();
  await expect(page.getByTestId('public-intake-structured-output-step')).toBeVisible();
  await page.getByTestId('public-intake-structured-continue').click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('public-intake-customer-address-line1')).toBeVisible();
  await page.getByTestId('public-intake-customer-address-line1').fill('400 Field Visit Rd');
  await page.getByTestId('public-intake-customer-city').fill('Austin');
  await page.getByTestId('public-intake-customer-state').fill('TX');
  await page.getByTestId('public-intake-customer-postal-code').fill('78706');
  await page.getByRole('button', { name: 'Review + Confirm' }).click();
  const intakeSubmitResponse = page.waitForResponse((response) =>
    response.url().includes('/api/projects/public-intake/') && response.request().method() !== 'GET'
  );
  await page.getByTestId('public-intake-submit-button').click();
  await intakeSubmitResponse;

  const appOrigin = new URL(page.url()).origin;
  await page.goto(`${appOrigin}/app/marketing?tab=leads&refresh=manual-intake`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('online-presence-setup-nav').getByRole('button', { name: /Business Information/ })).toHaveAttribute(
    'aria-current',
    'step'
  );
  await expect(page.getByRole('button', { name: 'Website Leads' })).toHaveCount(0);
  await expect(page.getByTestId('online-presence-leads-handoff')).toContainText(
    'Leads from your profile, QR code, and website appear in Opportunities.'
  );
  expect(state.leads[0].source).toBe('manual');
  expect(state.leads[0].status).toBe('ready_for_review');
});

test('qr project requests preserve qr source attribution', async ({ page }) => {
  let capturedSource = null;

  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        show_phone_public: true,
        show_email_public: true,
        show_license_public: true,
        allow_public_intake: true,
        allow_public_reviews: false,
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        review_count: 0,
        average_rating: null,
        gallery: [],
        reviews: [],
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/intake/', async (route) => {
    capturedSource = route.request().postDataJSON()?.source || null;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Your project request was submitted.' }),
    });
  });

  await page.goto('/contractors/bright-build-co?source=qr', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Full name').fill('QR Prospect');
  await page.getByPlaceholder('Email').fill('qr@example.com');
  await page.getByPlaceholder('Tell us about your project').fill('Scanned a QR code to ask for a quote.');
  await page.getByRole('button', { name: 'Submit Project Request' }).click();

  expect(capturedSource).toBe('qr');
});

test('public profile quote wizard submits and keeps a mobile-friendly success state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  let capturedBody = '';

  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        website_url: 'https://bright.example.com',
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        show_license_public: true,
        show_phone_public: true,
        show_email_public: false,
        allow_public_intake: true,
        allow_public_reviews: false,
        is_public: true,
        preview: false,
        seo_title: '',
        seo_description: '',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        logo_url: '',
        cover_image_url: '',
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route('**/api/contractors/bright-build-co/rating/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        preview: false,
        average_rating: null,
        review_count: 0,
        new_on_myhomebro: true,
        display_label: 'New on MyHomeBro',
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/request-quote/improve-description/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'Description improved.',
        description: 'Need a full kitchen refresh with cabinets, lighting, and new finishes.',
        source: 'ai',
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/request-quote/', async (route) => {
    capturedBody = route.request().postData() || '';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: 'Your quote request was sent.',
        intake_id: 402,
        lead_id: 902,
        status: 'new',
        request_path_label: 'Request a Quote',
      }),
    });
  });

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('public-profile-request-quote-cta')).toBeVisible();
  await page.getByTestId('public-profile-request-quote-cta').click();
  await expect(page.getByTestId('public-quote-request-wizard')).toBeVisible();
  await expect(page.getByTestId('public-quote-request-step-title')).toContainText('Project Basics');

  await page.getByTestId('public-quote-request-project-type').fill('Kitchen Remodel');
  await page.getByTestId('public-quote-request-project-subtype').fill('Cabinet refresh');
  await page.getByTestId('public-quote-request-description').fill(
    'Need a full kitchen refresh with new cabinets and updated lighting.'
  );
  await page.getByTestId('public-quote-request-improve-description').click();
  await expect(page.getByTestId('public-quote-request-description')).toHaveValue(
    'Need a full kitchen refresh with cabinets, lighting, and new finishes.'
  );

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('public-quote-request-clarifier-scope_priority').fill('Cabinet refresh and layout guidance');
  await page.getByTestId('public-quote-request-clarifier-site_conditions').fill('Occupied home with normal access');
  await page.getByTestId('public-quote-request-clarifier-materials_preferences').fill('Warm, durable finishes');

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('public-quote-request-photos-input')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByTestId('public-quote-request-address').fill('123 Main St');
  await page.getByTestId('public-quote-request-property-type').fill('Single-family home');
  await page.getByTestId('public-quote-request-city').fill('Austin');
  await page.getByTestId('public-quote-request-state').fill('TX');
  await page.getByTestId('public-quote-request-postal-code').fill('78701');
  await page.getByTestId('public-quote-request-timing').selectOption('asap');
  await page.getByTestId('public-quote-request-budget-range').selectOption('15k_to_30k');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('public-quote-request-full-name').fill('Jordan Prospect');
  await page.getByTestId('public-quote-request-email').fill('jordan@example.com');
  await page.getByTestId('public-quote-request-phone').fill('555-202-3030');
  await page.getByTestId('public-quote-request-contact-method').selectOption('email');
  await page.getByTestId('public-quote-request-contact-consent').check();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('public-quote-request-success')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  await expect(page.getByText('Reference: Lead #902')).toBeVisible();
  expect(capturedBody).toContain('desired_timing_text');
  expect(capturedBody).toContain('budget_range_text');
  expect(capturedBody).toContain('contact_consent');
});

test('hidden public contractor profile renders preview mode', async ({ page }) => {
  await page.route('**/api/projects/public/contractors/hidden-builder/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'hidden-builder',
        business_name_public: 'Hidden Builder Co',
        tagline: 'Hidden preview',
        bio: 'Preview-only profile.',
        is_public: false,
        preview: true,
        public_url: 'http://localhost:4173/contractors/hidden-builder',
        gallery: [],
        reviews: [],
      }),
    });
  });

  await page.goto('/contractors/hidden-builder', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('public-profile-preview-banner')).toBeVisible();
  await expect(page.getByText('Preview-only profile.')).toBeVisible();
});

test('contractor-sent intake returns to Marketing with Opportunities handoff', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  const state = {
    intake: null,
    lead: null,
  };

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
      body: JSON.stringify({
        onboarding_status: 'complete',
        connected: true,
      }),
    });
  });

  await page.route('**/api/projects/contractor-activation-summary/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ guide_sections: {} }),
    });
  });

  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 77,
        created_at: '2026-03-01T10:00:00Z',
      }),
    });
  });

  await page.route('**/api/projects/homeowners/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route('**/api/projects/intakes/', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    state.intake = {
      id: 501,
      ...body,
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(state.intake),
    });
  });

  await page.route(/.*\/api\/projects\/intakes\/501\/send-to-homeowner\/$/, async (route) => {
    state.intake = {
      ...(state.intake || {}),
      id: 501,
      share_token: 'contractor-sent-token',
      lead_source: 'contractor_sent_form',
      sent_at: '2026-03-26T09:00:00Z',
    };
    state.lead = {
      id: 701,
      source: 'contractor_sent_form',
      full_name: state.intake.customer_name,
      email: state.intake.customer_email,
      phone: state.intake.customer_phone,
      project_address: '',
      city: '',
      state: '',
      zip_code: '',
      project_type: '',
      project_description: '',
      preferred_timeline: '',
      budget_text: '',
      status: 'pending_customer_response',
      internal_notes: '',
      accepted_at: null,
      ai_analysis: {},
      created_at: '2026-03-26T09:00:00Z',
      converted_homeowner_id: null,
      converted_homeowner_name: '',
      converted_agreement: null,
      converted_at: null,
      source_intake_id: 501,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        intake_id: 501,
        email: state.intake.customer_email,
        url: 'http://localhost:4173/start-project/contractor-sent-token',
        lead_id: 701,
        lead_status: 'pending_customer_response',
        lead_source: 'contractor_sent_form',
      }),
    });
  });

  await page.route(/.*\/api\/projects\/public-intake\/?.*/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 501,
          token: url.searchParams.get('token'),
          status: 'submitted',
          initiated_by: 'contractor',
          contractor_name: 'Bright Build Co',
          customer_name: state.intake?.customer_name || 'Riley Customer',
          customer_email: state.intake?.customer_email || 'riley@example.com',
          customer_phone: state.intake?.customer_phone || '555-888-9999',
          customer_address_line1: '',
          customer_address_line2: '',
          customer_city: '',
          customer_state: '',
          customer_postal_code: '',
          same_as_customer_address: true,
          project_address_line1: '',
          project_address_line2: '',
          project_city: '',
          project_state: '',
          project_postal_code: '',
          accomplishment_text: '',
          submitted_at: null,
          sent_at: '2026-03-26T09:00:00Z',
          completed_at: null,
        }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    state.lead = {
      ...state.lead,
      source: state.lead?.source || 'contractor_sent_form',
      full_name: body.customer_name,
      email: body.customer_email,
      phone: body.customer_phone,
      project_address: body.project_address_line1,
      city: body.project_city,
      state: body.project_state,
      zip_code: body.project_postal_code,
      project_description: body.accomplishment_text,
      status: 'ready_for_review',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: 'Intake updated successfully.',
        id: 501,
        status: 'submitted',
        lead_id: 701,
        completed_at: '2026-03-26T10:00:00Z',
      }),
    });
  });

  await page.route(/public-profile\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        business_name_public: 'Bright Build Co',
        tagline: 'Trusted renovations and repairs',
        bio: 'We help homeowners with clean, reliable project delivery.',
        city: 'Austin',
        state: 'TX',
        service_area_text: 'Austin metro',
        years_in_business: 12,
        website_url: 'https://bright.example.com',
        phone_public: '555-111-2222',
        email_public: 'hello@bright.example.com',
        specialties: ['Roofing'],
        work_types: ['Repairs'],
        show_license_public: true,
        show_phone_public: true,
        show_email_public: false,
        allow_public_intake: true,
        allow_public_reviews: true,
        is_public: true,
        seo_title: '',
        seo_description: '',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        logo_url: '',
        cover_image_url: '',
      }),
    });
  });

  await page.route(/public-profile\/qr\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'bright-build-co',
        public_url: 'http://localhost:4173/contractors/bright-build-co',
        qr_target_url: 'http://localhost:4173/contractors/bright-build-co?source=qr',
        qr_svg: 'data:image/svg+xml;base64,PHN2Zy8+',
        download_filename: 'bright-build-co-public-profile-qr.svg',
      }),
    });
  });

  await page.route('**/api/projects/contractor/gallery/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
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
      body: JSON.stringify({ results: state.lead ? [state.lead] : [] }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/701\/$/, async (route) => {
    const body = route.request().postDataJSON();
    state.lead = { ...state.lead, ...body };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.lead),
    });
  });

  await page.route(/.*\/api\/projects\/intakes\/501\/$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 501,
        initiated_by: 'contractor',
        customer_name: state.lead?.full_name || 'Riley Customer',
        customer_email: state.lead?.email || 'riley@example.com',
        customer_phone: state.lead?.phone || '555-888-9999',
        customer_address_line1: state.lead?.project_address || '',
        customer_address_line2: '',
        customer_city: state.lead?.city || 'Austin',
        customer_state: state.lead?.state || 'TX',
        customer_postal_code: state.lead?.zip_code || '78705',
        same_as_customer_address: true,
        project_address_line1: state.lead?.project_address || '',
        project_address_line2: '',
        project_city: state.lead?.city || 'Austin',
        project_state: state.lead?.state || 'TX',
        project_postal_code: state.lead?.zip_code || '78705',
        accomplishment_text: state.lead?.project_description || '',
        ai_analysis_payload: state.lead?.ai_analysis || {},
      }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/701\/analyze\/$/, async (route) => {
    state.lead = {
      ...state.lead,
      ai_analysis: {
        project_type: 'Remodel',
        project_subtype: 'Bathroom Remodel',
        suggested_title: 'Bathroom Remodel - Riley Customer',
        suggested_description: 'AI analysis from contractor-sent intake.',
        clarifications_needed: [{ key: 'fixtures', label: 'Who is selecting fixtures?' }],
        milestone_outline: [{ order: 1, title: 'Demo' }, { order: 2, title: 'Build' }],
        recommended_templates: [{ id: 801, name: 'Bathroom Remodel Template' }],
        template_id: 801,
        template_name: 'Bathroom Remodel Template',
      },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lead_id: 701, ai_analysis: state.lead.ai_analysis }),
    });
  });

  await page.route(/.*\/api\/projects\/contractor\/public-leads\/701\/create-agreement\/$/, async (route) => {
    state.lead = {
      ...state.lead,
      converted_homeowner_id: 222,
      converted_homeowner_name: state.lead.full_name,
      converted_agreement: 901,
      converted_at: '2026-03-26T10:10:00Z',
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        agreement_id: 901,
        detail_url: '/app/agreements/901',
        wizard_url: '/app/agreements/901/wizard?step=1',
        created: true,
      }),
    });
  });

  await page.goto('/app/intake/new', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('intake-mode-send-to-customer').check();
  await page.getByPlaceholder('e.g., Jane Smith').fill('Riley Customer');
  await page.getByPlaceholder('jane@example.com').fill('riley@example.com');
  await page.getByPlaceholder('(555) 555-5555').fill('555-888-9999');
  await page.getByTestId('intake-send-to-customer').click();

  await page.goto('/start-project/contractor-sent-token', { waitUntil: 'domcontentloaded' });
  await page
    .getByTestId('public-intake-accomplishment-text')
    .fill('Complete a bathroom remodel with updated tile and fixtures.');
  await expect(page.getByTestId('public-intake-generate-structure')).toBeEnabled({ timeout: 10000 });
  await page.getByTestId('public-intake-generate-structure').click();
  await page.getByTestId('public-intake-clarification-next').click();
  await expect(page.getByTestId('public-intake-project-snapshot')).toBeVisible();
  await page.getByTestId('public-intake-project-snapshot-continue').click();
  await expect(page.getByTestId('public-intake-structured-output-step')).toBeVisible();
  await page.getByTestId('public-intake-structured-continue').click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('public-intake-customer-address-line1')).toBeVisible();
  await page.getByTestId('public-intake-customer-address-line1').fill('300 Scope St');
  await page.getByTestId('public-intake-customer-city').fill('Austin');
  await page.getByTestId('public-intake-customer-state').fill('TX');
  await page.getByTestId('public-intake-customer-postal-code').fill('78705');
  await page.getByRole('button', { name: 'Review + Confirm' }).click();
  await page.getByTestId('public-intake-submit-button').click();

  await page.goto('/app/marketing', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Website Leads' })).toHaveCount(0);
  await expect(page.getByTestId('online-presence-leads-handoff')).toContainText(
    'Leads from your profile, QR code, and website appear in Opportunities.'
  );
  await expect(
    page.getByRole('link', { name: /View website leads in Opportunities/i })
  ).toHaveAttribute('href', '/app/opportunities?source=website');
  expect(state.lead.full_name).toBe('Riley Customer');
  expect(state.lead.status).toBe('ready_for_review');
  expect(state.lead.source).toBe('contractor_sent_form');
});

