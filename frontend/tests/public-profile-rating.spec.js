import { expect, test } from '@playwright/test';

test('public profile shows verified rating and opens review modal from invoice link', async ({ page }) => {
  const profile = {
    slug: 'bright-build-co',
    business_name_public: 'Bright Build Co',
    tagline: 'Trusted renovations and repairs',
    bio: 'We help homeowners with clean, reliable project delivery.',
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
    seo_title: '',
    seo_description: '',
    public_url: 'http://localhost:4173/contractors/bright-build-co',
    logo_url: '',
    cover_image_url: '',
    gallery: [],
    reviews: [
      {
        id: 1,
        customer_name: 'Taylor Homeowner',
        rating: 5,
        title: 'Excellent work',
        review_text: 'Professional from start to finish.',
        is_verified: true,
        linked_invoice_id: 77,
        linked_milestone_id: null,
        submitted_at: '2026-03-25T10:00:00Z',
      },
    ],
    contractor_profile_insights: [],
    preview: false,
    average_rating: 5,
    review_count: 1,
  };

  const rating = {
    slug: 'bright-build-co',
    preview: false,
    average_rating: 5,
    review_count: 1,
    new_on_myhomebro: false,
    display_label: '5.00 average rating',
  };

  await page.route('**/api/projects/public/contractors/bright-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile),
    });
  });

  await page.route('**/api/contractors/bright-build-co/rating/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rating),
    });
  });

  await page.route('**/api/projects/public/contractors/bright-build-co/reviews/', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.linked_invoice).toBe('77');
      expect(body.customer_name).toBe('Jordan Client');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Thanks for your verified review. It will appear on the public profile.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: profile.reviews }),
    });
  });

  await page.goto('/contractors/bright-build-co?review=1&invoice=77');

  await expect(page.getByTestId('public-profile-rating-display')).toContainText('5.0 average rating');
  await expect(page.getByTestId('public-profile-rating-display')).toContainText('1 verified review');
  await expect(page.getByTestId('public-profile-review-modal')).toBeVisible();

  await page.getByPlaceholder('Your name').fill('Jordan Client');
  await page.getByPlaceholder('Review title').fill('Strong finish');
  await page.getByPlaceholder('Share your experience').fill('Great communication and a clean finish.');
  await page.getByRole('button', { name: 'Submit Review' }).click();

  await expect(page.getByTestId('public-profile-review-modal')).toHaveCount(0);
});

test('public profile shows new on myhomebro when no verified reviews exist', async ({ page }) => {
  const profile = {
    slug: 'new-build-co',
    business_name_public: 'New Build Co',
    tagline: 'Just getting started',
    bio: '',
    proposal_tone: 'friendly',
    preferred_signoff: 'Best, New Build Co',
    brand_primary_color: '#2563eb',
    city: 'Austin',
    state: 'TX',
    service_area_text: 'Austin metro',
    years_in_business: 2,
    website_url: '',
    phone_public: '',
    email_public: '',
    specialties: [],
    work_types: [],
    show_license_public: true,
    show_phone_public: true,
    show_email_public: false,
    allow_public_intake: true,
    allow_public_reviews: true,
    is_public: true,
    seo_title: '',
    seo_description: '',
    public_url: 'http://localhost:4173/contractors/new-build-co',
    logo_url: '',
    cover_image_url: '',
    gallery: [],
    reviews: [],
    contractor_profile_insights: [],
    preview: false,
    average_rating: null,
    review_count: 0,
  };

  await page.route('**/api/projects/public/contractors/new-build-co/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile),
    });
  });

  await page.route('**/api/contractors/new-build-co/rating/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slug: 'new-build-co',
        preview: false,
        average_rating: null,
        review_count: 0,
        new_on_myhomebro: true,
        display_label: 'New on MyHomeBro',
      }),
    });
  });

  await page.route('**/api/projects/public/contractors/new-build-co/reviews/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto('/contractors/new-build-co');

  await expect(page.getByTestId('public-profile-rating-display')).toContainText('New on MyHomeBro');
  await expect(page.getByTestId('public-profile-rating-summary')).toContainText('New on MyHomeBro');
  await expect(page.getByText('This contractor is building their verified review history.')).toBeVisible();
});
