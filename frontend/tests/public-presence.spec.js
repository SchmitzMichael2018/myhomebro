import { expect, test } from '@playwright/test';

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
    leads: [
      {
        id: 11,
        source: 'profile',
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

  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = await route.request().postDataBuffer();
      if (body) {
        state.profile.tagline = 'Now booking spring projects';
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...state.profile, tagline: 'Now booking spring projects' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.profile),
    });
  });

  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
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

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
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

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('public-presence-title')).toBeVisible();
  await expect(page.getByTestId('public-presence-qr-image')).toBeVisible();
  await expect(page.getByTestId('public-presence-profile-hint')).toContainText(
    'Add project photos to strengthen your public profile'
  );
  await page.getByPlaceholder('Tagline').fill('Now booking spring projects');
  await page.getByTestId('public-presence-save-profile').click();
  await expect(page.getByPlaceholder('Tagline')).toHaveValue('Now booking spring projects');

  await page.getByRole('button', { name: 'Gallery' }).click();
  await page.getByPlaceholder('Title').fill('Kitchen Remodel');
  await page.setInputFiles('input[type="file"]', {
    name: 'kitchen.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fake-image'),
  });
  await page.getByRole('button', { name: 'Add Gallery Item' }).click();
  await expect(page.getByTestId('public-presence-gallery-tab')).toContainText('Kitchen Remodel');

  await page.getByRole('button', { name: 'Reviews' }).click();
  await expect(page.getByTestId('public-presence-reviews-tab')).toContainText('Taylor Homeowner');
  await expect(page.getByTestId('public-presence-reviews-tab')).toContainText('Pending moderation');
  await page.getByRole('button', { name: 'Publish Review' }).click();
  await expect(page.getByTestId('public-presence-reviews-tab')).toContainText('Public');
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Casey Prospect');
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'Review the intake and decide whether to accept or reject'
  );
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('accepted');
  await page.getByRole('button', { name: 'Analyze Intake with AI' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Kitchen Remodel - Casey Prospect'
  );
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'Review the AI suggestions and create a draft agreement'
  );
  await page.getByRole('button', { name: 'Create AI-Assisted Agreement' }).click();
  await page.waitForURL('**/app/agreements/901/wizard?step=1');

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await page.getByRole('button', { name: 'Mark Contacted' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('contacted');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Converted to customer: Casey Prospect'
  );
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
  await expect(page.getByText('Kitchen Remodel')).toBeVisible();
  await expect(page.getByText('Taylor Homeowner')).toBeVisible();
  await page.getByRole('link', { name: 'Leave Review' }).click();
  await page.getByPlaceholder('Your name').fill('Morgan Reviewer');
  await page.getByPlaceholder('Review title').fill('Great communication');
  await page.getByPlaceholder('Share your experience').fill('Clear updates and clean work.');
  await page.getByRole('button', { name: 'Submit Review' }).click();
  await expect(page.getByPlaceholder('Your name')).toHaveValue('');
  await page.getByPlaceholder('Full name').fill('Casey Prospect');
  await page.getByPlaceholder('Email').fill('casey@example.com');
  await page.getByPlaceholder('Tell us about your project').fill('Need a remodel estimate.');
  await page.getByRole('button', { name: 'Submit Project Request' }).click();
  await expect(page.getByPlaceholder('Full name')).toHaveValue('');
});

test('hidden public contractor profile is not exposed', async ({ page }) => {
  await page.route('**/api/projects/public/contractors/hidden-builder/', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Not found.' }),
    });
  });

  await page.goto('/contractors/hidden-builder', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('This contractor profile is not available.')).toBeVisible();
});
