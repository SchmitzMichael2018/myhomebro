import { expect, test } from '@playwright/test';

const captureId = '11111111-1111-4111-8111-111111111111';

function captureRow(patches = {}) {
  return {
    id: captureId,
    capture_type: 'quick_lead',
    status: 'saved',
    capture_method: 'typed',
    raw_text_payload: {
      name: 'John',
      phone: '281-555-0100',
      text: 'Needs a deck',
    },
    artifacts: [],
    events: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        event_type: 'created',
        to_status: 'saved',
        created_at: '2026-07-25T12:00:00Z',
      },
    ],
    captured_by_name: 'Pat Contractor',
    version: 1,
    original_captured_at: '2026-07-25T12:00:00Z',
    created_at: '2026-07-25T12:00:00Z',
    ...patches,
  };
}

async function installMocks(page) {
  const requests = [];
  await page.addInitScript(() => {
    window.localStorage.setItem('access', 'capture-test-token');
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });

  await page.route('**/api/projects/whoami/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'capture@example.com',
      }),
    })
  );
  await page.route('**/api/projects/notifications/unread-count/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' })
  );
  await page.route('**/api/projects/captures/summary/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pending: 1,
        needs_review: 0,
        applied: 0,
        failed: 0,
        archived: 0,
        today: 1,
      }),
    })
  );
  await page.route(`**/api/projects/captures/${captureId}/`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(captureRow()),
    })
  );
  await page.route('**/api/projects/captures/project-options/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 41,
          number: 'PRJ-0041',
          title: 'Flooring installation',
          customer_name: 'Casey Customer',
          milestones: [{ id: 51, title: 'Install flooring', completed: false }],
        }],
      }),
    })
  );
  await page.route(/\/api\/projects\/captures\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const contentType = route.request().headers()['content-type'] || '';
      const multipartBody = route.request().postData() || '';
      const multipartType = multipartBody.match(
        /name="capture_type"\r?\n\r?\n([^\r\n]+)/
      )?.[1];
      const body = contentType.includes('application/json')
        ? route.request().postDataJSON()
        : { capture_type: multipartType || 'photo', multipartBody };
      requests.push(body);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(
          captureRow({
            capture_type: body.capture_type,
            capture_method: body.capture_method || 'camera',
            raw_text_payload: body.raw_text_payload || {},
            artifacts:
              body.capture_type === 'photo'
                ? [{ id: 'photo-1', original_filename: 'job.jpg', mime_type: 'image/jpeg', file_size: 4 }]
                : [],
          })
        ),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 1, next: null, previous: null, results: [captureRow()] }),
    });
  });
  await page.route('**/api/projects/project-assistant/smart-capture/sessions/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    })
  );
  return requests;
}

test('Capture launcher saves a Quick Lead without creating business records', async ({ page }) => {
  const requests = await installMocks(page);
  await page.goto('/app/capture');
  await page.getByTestId('global-capture-trigger').click();

  const launcher = page.getByTestId('capture-launcher');
  await expect(launcher.getByRole('button', { name: 'I met someone' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'I need to remember something' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Save a photo' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Capture a receipt' })).toBeVisible();
  await expect(launcher).toContainText('More coming soon');

  await launcher.getByRole('button', { name: 'I met someone' }).click();
  await launcher.getByLabel('Name').fill('John');
  await launcher.getByLabel('Phone').fill('281-555-0100');
  await launcher.getByLabel('What did you discuss?').fill('Needs a deck');
  await launcher.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByTestId('capture-launcher')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    capture_type: 'quick_lead',
    capture_method: 'typed',
    raw_text_payload: {
      name: 'John',
      phone: '281-555-0100',
      text: 'Needs a deck',
    },
  });
});

test('Quick Note saves raw note and voice failure leaves typing available', async ({ page }) => {
  const requests = await installMocks(page);
  await page.goto('/app/capture');
  await page.getByTestId('global-capture-trigger').click();
  await page.getByTestId('capture-action-note').click();
  await page.getByTestId('capture-voice-toggle').click();
  await expect(page.getByText('Voice is unavailable. Continue by typing.')).toBeVisible();
  await page.getByTestId('capture-text-input').fill('Call the supplier tomorrow');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  expect(requests[0]).toMatchObject({
    capture_type: 'quick_note',
    raw_text_payload: { text: 'Call the supplier tomorrow' },
  });
});

test('Photo capture uploads an image and receipt opens existing Smart Capture', async ({ page }) => {
  const requests = await installMocks(page);
  await page.goto('/app/capture');
  await page.getByTestId('global-capture-trigger').click();
  await page.getByTestId('capture-action-photo').click();
  await page.getByTestId('capture-photo').locator('input[type="file"]').setInputFiles({
    name: 'job.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('photo'),
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(requests[0].capture_type).toBe('photo');

  await page.getByTestId('global-capture-trigger').click();
  await page.getByTestId('capture-action-receipt').click();
  await expect(page.getByTestId('project-assistant-smart-capture')).toBeVisible();
  await expect(page.getByTestId('smart-capture-type-receipt')).toBeVisible();
});

test('Project Capture requires project context and saves a Project Update for review', async ({ page }) => {
  const requests = await installMocks(page);
  await page.goto('/app/capture');
  await page.getByTestId('global-capture-trigger').click();
  const launcher = page.getByTestId('capture-launcher');
  await expect(launcher.getByRole('button', { name: 'Project update' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Progress photos' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Document an issue' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Log a communication' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Add a project document' })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Add Equipment' })).toHaveCount(0);
  await expect(launcher.getByRole('button', { name: 'Save Warranty Information' })).toHaveCount(0);
  await expect(launcher.getByRole('button', { name: 'Report Warranty Concern' })).toHaveCount(0);

  await page.getByTestId('capture-action-project_update').click();
  await page.getByLabel('Project').selectOption('41');
  await page.getByLabel('Milestone').selectOption('51');
  await page.getByLabel('What work was completed?').fill('Installed flooring in the living room.');
  await expect(page.getByText(/does not complete a milestone/i)).toBeVisible();
  await page.getByRole('button', { name: 'Save for review' }).click();

  expect(requests).toHaveLength(1);
  expect(requests[0].capture_type).toBe('project_update');
  expect(requests[0].multipartBody).toContain('Installed flooring in the living room.');
});

test('Inbox renders metrics, row actions, and Capture detail', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await installMocks(page);
  await page.goto('/app/capture');
  await expect(page.getByTestId('capture-summary')).toContainText('Pending');
  await expect(page.getByTestId('capture-summary')).toContainText('Today');
  await expect(page.getByPlaceholder('Search Captures')).toBeVisible();
  await expect(page.getByLabel('Filter by status')).toBeVisible();
  await expect(page.getByLabel('Filter by type')).toBeVisible();
  await expect(page.getByLabel('Capture results')).toContainText('John');
  await page.getByTestId('capture-inbox').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/capture/${captureId}$`));
  await expect(page.getByTestId('capture-detail')).toContainText('Original contents');
  await expect(page.getByTestId('capture-detail')).toContainText('Needs a deck');
  await expect(page.getByTestId('capture-detail')).toContainText('Timeline');
  expect(consoleErrors).toEqual([]);
});

test('mobile launcher is full-height, keyboard-safe, and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMocks(page);
  await page.goto('/app/capture');
  await page.getByTestId('global-capture-trigger').click();
  const launcher = page.getByTestId('capture-launcher');
  await expect(launcher).toBeVisible();
  const geometry = await launcher.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(geometry.height).toBeGreaterThanOrEqual(840);
  expect(geometry.overflow).toBeFalsy();
  await page.keyboard.press('Escape');
  await expect(launcher).toHaveCount(0);
});
