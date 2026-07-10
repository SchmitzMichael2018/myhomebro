import { expect, test } from '@playwright/test';

function listResponse(results) {
  return JSON.stringify({ results });
}

function smartSession(type = 'receipt', patch = {}) {
  const isReceipt = type === 'receipt';
  return {
    id: isReceipt ? '33333333-3333-4333-8333-333333333333' : '44444444-4444-4444-8444-444444444444',
    capture_type: type,
    status: 'review_ready',
    original_filename: isReceipt ? 'receipt.jpg' : 'label.jpg',
    mime_type: 'image/jpeg',
    file_size: 1200,
    source_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    raw_extracted_text: isReceipt ? 'Merchant: Tile Depot\nTotal: 286.41' : 'Manufacturer: Rheem\nModel: XG50\nSerial: WH-123',
    structured_payload: isReceipt
      ? {
          merchant_name: 'Tile Depot',
          purchase_date: '2026-07-09',
          total: '286.41',
          tax: '21.41',
          suggested_category: 'materials',
          project_reference: 'Johnson Bathroom Remodel',
          notes: 'LVP and trim materials',
        }
      : {
          destination: 'contractor_equipment',
          product_name: 'Rheem Water Heater',
          manufacturer: 'Rheem',
          model_number: 'XG50',
          serial_number: 'WH-123',
          sku: 'RHEEM-50',
          warranty_expiration: '',
          notes: 'Label scan',
        },
    field_confidence: isReceipt
      ? { merchant_name: 'high_confidence', purchase_date: 'high_confidence', total: 'high_confidence', tax: 'medium_confidence' }
      : { product_name: 'high_confidence', manufacturer: 'high_confidence', model_number: 'high_confidence', serial_number: 'needs_review' },
    missing_fields: [],
    warnings: isReceipt ? [] : ['Warranty expiration was not detected.'],
    possible_matches: [],
    approved_payload: {},
    created_expense: null,
    created_asset: null,
    created_property_record: null,
    audit_metadata: { no_autonomous_record_creation: true },
    ...patch,
  };
}

async function installAssistantMocks(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'playwright-access-token');
  });

  await page.route('**/api/projects/whoami/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, type: 'contractor', role: 'contractor_owner', email: 'playwright@myhomebro.local' }),
    });
  });
  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding_status: 'complete', connected: true }) });
  });
  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 77, ai: { access: 'included', enabled: true } }) });
  });
  await page.route('**/api/projects/contractor-activation-summary/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ guide_sections: {} }) });
  });
  await page.route(/\/api\/projects\/agreements\/?(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/contractor/public-leads/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/templates/discover/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/recommendations/me/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recommendations: [] }) });
  });
}

test('desktop Smart Capture uploads a receipt, reviews fields, and approves a draft expense only after confirmation', async ({ page }) => {
  await installAssistantMocks(page);
  let createdRecords = 0;

  await page.route('**/api/projects/project-assistant/smart-capture/sessions/', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(smartSession('receipt')) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/project-assistant/smart-capture/sessions/*/', async (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(smartSession('receipt', { structured_payload: { ...smartSession('receipt').structured_payload, ...body.structured_payload } })),
    });
  });
  await page.route('**/api/projects/project-assistant/smart-capture/sessions/*/approve/', async (route) => {
    createdRecords += 1;
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(smartSession('receipt', {
        status: 'completed',
        structured_payload: { ...smartSession('receipt').structured_payload, ...body.structured_payload },
        created_expense: 901,
      })),
    });
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('project-assistant-smart-capture')).toBeVisible();
  await page.getByTestId('smart-capture-type-receipt').click();
  await page.getByTestId('smart-capture-file-input').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('Merchant: Tile Depot\nTotal: 286.41'),
  });
  await page.getByTestId('smart-capture-upload').click();

  await expect(page.getByTestId('smart-capture-field-merchant_name')).toHaveValue('Tile Depot');
  await expect(page.getByTestId('smart-capture-approval-summary')).toContainText('No reimbursement');
  expect(createdRecords).toBe(0);

  await page.getByTestId('smart-capture-field-total').fill('300.00');
  await page.getByTestId('smart-capture-save-draft').click();
  await expect(page.getByTestId('smart-capture-field-total')).toHaveValue('300.00');
  await page.getByTestId('smart-capture-approve').click();
  await expect(page.getByTestId('smart-capture-completed')).toContainText('Expense #901');
  expect(createdRecords).toBe(1);
});

test('mobile Smart Capture reviews a product label without horizontal overflow', async ({ page }) => {
  await installAssistantMocks(page);
  await page.route('**/api/projects/project-assistant/smart-capture/sessions/', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(smartSession('equipment_label')) });
  });
  await page.route('**/api/projects/project-assistant/smart-capture/sessions/*/approve/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(smartSession('equipment_label', { status: 'completed', created_asset: 77 })),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-home-open-assistant').click();
  const sheet = page.getByTestId('assistant-mobile-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('smart-capture-type-equipment_label').click();
  await sheet.getByTestId('smart-capture-file-input').setInputFiles({
    name: 'label.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('Manufacturer: Rheem\nModel: XG50\nSerial: WH-123'),
  });
  await sheet.getByTestId('smart-capture-upload').click();
  await expect(sheet.getByTestId('smart-capture-field-manufacturer')).toHaveValue('Rheem');
  await expect(sheet.getByTestId('smart-capture-approval-summary')).toContainText('No warranty claim');
  await sheet.getByTestId('smart-capture-approve').click();
  await expect(sheet.getByTestId('smart-capture-completed')).toContainText('Asset #77');

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasHorizontalOverflow).toBe(false);
});
