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
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Public Profile');
  await expect(page.getByTestId('public-lead-funnel')).toContainText('Review');
  await expect(page.getByTestId('public-lead-funnel')).toContainText('Analyze');
  await expect(page.getByTestId('public-lead-funnel')).toContainText('Draft');
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'Review the intake details and accept the lead if it is a fit'
  );
  await page.getByRole('button', { name: 'Accept Lead' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Accepted');
  await page.getByRole('button', { name: 'Analyze Intake with AI' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Kitchen Remodel - Casey Prospect'
  );
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'Review the AI suggestions and create the draft agreement'
  );
  await page.getByRole('button', { name: 'Create AI-Assisted Agreement' }).click();
  await page.waitForURL('**/app/agreements/901/wizard?step=1');

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await page.getByRole('button', { name: 'Mark Contacted' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Contacted');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Converted to customer: Casey Prospect'
  );
});

test('landing-source intake and public-profile intake land in the same contractor leads flow', async ({
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

  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
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

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
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
    const body = route.request().postDataJSON();
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

    const body = route.request().postDataJSON();
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

  await page.goto('/contractors/bright-build-co', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Full name').fill('Profile Prospect');
  await page.getByPlaceholder('Email').fill('profile@example.com');
  await page.getByPlaceholder('Tell us about your project').fill('Public profile intake request.');
  await page.getByRole('button', { name: 'Submit Project Request' }).click();

  await page.goto('/start-project/landing-token', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('public-intake-accomplishment-text').fill(
    'Landing page intake request.'
  );
  await expect(page.getByTestId('public-intake-generate-structure')).toBeEnabled();
  await page.getByTestId('public-intake-generate-structure').click();
  await expect(page.getByTestId('public-intake-project-summary')).toBeVisible();
  await expect(page.getByTestId('public-intake-clarification-photo-section')).toBeVisible();
  await page.getByTestId('public-intake-clarification-next').click();
  await expect(page.getByTestId('public-intake-project-snapshot')).toBeVisible();
  await expect(page.getByTestId('public-intake-project-snapshot-title')).toContainText('Project Snapshot');
  await page.getByTestId('public-intake-project-snapshot-continue').click();
  await expect(page.getByTestId('public-intake-structured-output-step')).toBeVisible();
  await expect(page.getByTestId('public-intake-structured-output-title')).toContainText('Your Project Plan');
  await page.getByTestId('public-intake-structured-continue').click();
  await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
  await expect(page.getByTestId('public-intake-customer-address-line1')).toBeVisible();
  await page.getByTestId('public-intake-customer-address-line1').fill('100 Landing Way');
  await page.getByTestId('public-intake-customer-city').fill('Austin');
  await page.getByTestId('public-intake-customer-state').fill('TX');
  await page.getByTestId('public-intake-customer-postal-code').fill('78701');
  await page.getByRole('button', { name: 'Review + Confirm' }).click();
  await page.getByTestId('public-intake-submit-button').click();

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Profile Prospect');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Landing Prospect');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Public Profile');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Landing Page');

  await page.getByRole('button', { name: 'Landing Prospect' }).first().click();
  await page.getByRole('button', { name: 'Accept Lead' }).click();
  await page.getByRole('button', { name: 'Analyze Intake with AI' }).click();
  await page.getByRole('button', { name: 'Create AI-Assisted Agreement' }).click();
  await page.waitForURL('**/app/agreements/901/wizard?step=1');

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await page.getByRole('button', { name: 'Profile Prospect' }).click();
  await page.getByRole('button', { name: 'Accept Lead' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Accepted');
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

test('manual leads can be quick-added, sent an intake, and stay in the same lead flow', async ({
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

  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
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

  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
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

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
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

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await page.getByTestId('quick-add-lead-button').click();
  await expect(page.getByTestId('quick-add-lead-sheet')).toBeVisible();
  await page.getByPlaceholder('Full name').fill('Walk Up Prospect');
  await page.getByPlaceholder('(555) 555-5555').fill('5556660000');
  await page.getByTestId('quick-add-lead-more-toggle').click();
  await page.getByPlaceholder('name@example.com').fill('walkup@example.com');
  await page.getByPlaceholder('123 Main St').fill('400 Field Visit Rd');
  await page.getByPlaceholder('Kitchen remodel, roof repair, bath update...').fill(
    'Garage conversion'
  );
  await page
    .getByPlaceholder('Referral details, timeline, follow-up plan, or anything you want to remember.')
    .fill('Met on site and discussed a garage conversion.');
  await page.getByTestId('manual-lead-save').click();

  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Walk Up Prospect');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Manual');
  await expect(page.getByRole('button', { name: 'Accept Lead' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject Lead' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send Intake Form' })).toBeVisible();
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText('warm lead');

  await page.getByRole('button', { name: 'Send Intake Form' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Waiting on Customer');
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'You sent the intake form'
  );

  await page.goto('/start-project/manual-token', { waitUntil: 'domcontentloaded' });
  await page
    .getByTestId('public-intake-accomplishment-text')
    .fill('Convert the garage into a finished office and laundry room.');
  await expect(page.getByTestId('public-intake-generate-structure')).toBeEnabled();
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
  await page.getByTestId('public-intake-submit-button').click();

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await page.getByRole('button', { name: 'Walk Up Prospect' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Manual');
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText('Ready for Review');
  await expect(page.getByRole('button', { name: 'Review Intake' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept Lead' })).toHaveCount(0);
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

test('contractor-sent intake flows into the same lead inbox without cold-lead accept actions', async ({
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

  await page.route('**/api/projects/contractor/public-profile/', async (route) => {
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

  await page.route('**/api/projects/contractor/public-profile/qr/', async (route) => {
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

  await page.route('**/api/projects/contractor/public-leads/', async (route) => {
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
  await expect(page.getByTestId('public-intake-generate-structure')).toBeEnabled();
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

  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Contractor Form'
  );
  await expect(page.getByTestId('public-lead-funnel')).toContainText('Analyze');
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'Review the completed intake first. Then analyze it or move straight into a draft agreement'
  );
  await expect(page.getByRole('button', { name: 'Accept Lead' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject Lead' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review Intake' }).click();
  await page.waitForURL('**/app/intake/new?intakeId=501');
  await expect(page.getByPlaceholder('e.g., Jane Smith')).toHaveValue('Riley Customer');
  await page.goto('/app/public-presence', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Public Leads' }).click();
  await page.getByRole('button', { name: 'Analyze Intake with AI' }).click();
  await expect(page.getByTestId('public-presence-leads-tab')).toContainText(
    'Bathroom Remodel - Riley Customer'
  );
  await expect(page.getByTestId('public-lead-workflow-hint')).toContainText(
    'Review the completed intake, confirm the AI summary, and create the draft agreement'
  );
  await page.getByRole('button', { name: 'Create AI-Assisted Agreement' }).click();
  await page.waitForURL('**/app/agreements/901/wizard?step=1');
});
