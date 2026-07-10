import { expect, test } from '@playwright/test';

function listResponse(results) {
  return JSON.stringify({ results });
}

function sessionPayload(text = 'Sarah Johnson needs a bathroom remodel at 123 Oak Street. Her email is sarah@example.com.') {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'draft',
    intent: 'create_customer_and_opportunity',
    source_text: text,
    conversation_payload: {
      turns: [{ role: 'contractor', text }],
    },
    prepared_payload: {
      conversation_id: '22222222-2222-4222-8222-222222222222',
      intent: 'create_customer_and_opportunity',
      customer_draft: {
        display_name: 'Sarah Johnson',
        email: 'sarah@example.com',
      },
      opportunity_draft: {
        title: 'Sarah Johnson - Shower',
        project_category: 'Bathroom Remodel',
        project_subtype: 'Shower',
        property_address: '123 Oak Street',
        description: text,
      },
      missing_fields: [],
      assumptions: ['Project category appears to be Bathroom Remodel.'],
      possible_duplicates: [],
      follow_up_question: 'Review the prepared draft. What would you like to approve or adjust?',
      safety_summary: [
        'No customer message will be sent.',
        'No estimate appointment will be scheduled.',
        'No agreement, project, assignment, invoice, or payment will be created.',
      ],
    },
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
      body: JSON.stringify({
        id: 7,
        type: 'contractor',
        role: 'contractor_owner',
        email: 'playwright@myhomebro.local',
      }),
    });
  });
  await page.route('**/api/payments/onboarding/status/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true }) });
  });
  await page.route('**/api/projects/contractors/me/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 77, ai: { enabled: true } }) });
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

  await page.route('**/api/projects/project-assistant/quick-capture/sessions/', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(sessionPayload(body.text)),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: listResponse([]) });
  });
  await page.route('**/api/projects/project-assistant/quick-capture/sessions/*/approve/', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...sessionPayload(), status: 'approved', created_customer: 12, created_opportunity: 34 }),
    });
  });
}

async function installSpeechMocks(page, { permissionDenied = false } = {}) {
  await page.addInitScript(({ permissionDenied: denied }) => {
    window.__spokenPrompts = [];
    window.__recognitionInstances = [];
    class SpeechRecognitionMock {
      constructor() {
        window.__recognitionInstances.push(this);
        this.continuous = false;
        this.interimResults = false;
        this.lang = 'en-US';
      }
      start() {
        this.onstart?.();
        setTimeout(() => {
          if (denied) {
            this.onerror?.({ error: 'not-allowed', message: 'Permission denied' });
            this.onend?.();
            return;
          }
          this.onresult?.({
            results: [
              {
                0: { transcript: 'Sarah Johnson needs a bathroom remodel at 123 Oak Street. Her email is sarah@example.com.' },
                isFinal: true,
              },
            ],
          });
          this.onend?.();
        }, 25);
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    class UtteranceMock {
      constructor(text) {
        this.text = text;
      }
    }
    window.SpeechRecognition = SpeechRecognitionMock;
    window.webkitSpeechRecognition = SpeechRecognitionMock;
    window.SpeechSynthesisUtterance = UtteranceMock;
    window.speechSynthesis = {
      speak(utterance) {
        window.__spokenPrompts.push(utterance.text);
        utterance.onstart?.();
        setTimeout(() => utterance.onend?.(), 5);
      },
      cancel() {},
    };
  }, { permissionDenied });
}

test('desktop Voice Mode captures editable transcript and still requires visible approval', async ({ page }) => {
  await installSpeechMocks(page);
  await installAssistantMocks(page);
  let approveRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/quick-capture/sessions/') && request.url().includes('/approve/')) {
      approveRequests += 1;
    }
  });

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('quick-capture-voice-toggle').click();
  await expect(page.getByTestId('quick-capture-voice-panel')).toBeVisible();
  await page.getByTestId('quick-capture-voice-listen').click();
  await expect(page.getByTestId('quick-capture-voice-transcript')).toHaveValue(/Sarah Johnson/);
  await page.getByTestId('quick-capture-voice-transcript').fill('Sarah Johnson needs a bathroom remodel at 123 Oak Street. Her email is sarah@example.com.');
  await page.getByTestId('quick-capture-use-transcript').click();
  await expect(page.getByTestId('quick-capture-input')).toHaveValue(/Sarah Johnson needs/);
  await page.getByTestId('quick-capture-send').click();

  await expect(page.getByTestId('quick-capture-prepared-record')).toContainText('Sarah Johnson');
  await expect(page.getByTestId('project-assistant-human-approval')).toBeVisible();
  expect(approveRequests).toBe(0);
  await page.getByTestId('quick-capture-approve').click();
  await expect(page.getByTestId('quick-capture-approved')).toBeVisible();
  expect(approveRequests).toBe(1);
});

test('mobile Voice Mode works inside full-screen assistant and can switch back to typing', async ({ page }) => {
  await installSpeechMocks(page);
  await installAssistantMocks(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('assistant-home-open-assistant').click();
  const sheet = page.getByTestId('assistant-mobile-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('quick-capture-voice-toggle').click();
  await sheet.getByTestId('quick-capture-voice-listen').click();
  await expect(sheet.getByTestId('quick-capture-voice-transcript')).toHaveValue(/Sarah Johnson/);
  await sheet.getByTestId('quick-capture-use-transcript').click();
  await sheet.getByTestId('quick-capture-input').fill('Sarah Johnson needs a bathroom remodel at 123 Oak Street. Her email is sarah@example.com. Add a walk-in shower.');
  await sheet.getByTestId('quick-capture-send').click();
  await sheet.getByTestId('quick-capture-draft-customer-draft').getByRole('button').click();
  await expect(sheet.getByTestId('quick-capture-prepared-record')).toContainText('Sarah Johnson');
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasHorizontalOverflow).toBe(false);
});

test('Voice Mode falls back cleanly when microphone permission is denied', async ({ page }) => {
  await installSpeechMocks(page, { permissionDenied: true });
  await installAssistantMocks(page);

  await page.goto('/app/assistant', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('quick-capture-voice-toggle').click();
  await page.getByTestId('quick-capture-voice-listen').click();
  await expect(page.getByTestId('quick-capture-voice-error')).toContainText('Microphone permission was denied');
  await page.getByTestId('quick-capture-input').fill('Typing still works after microphone denial.');
  await expect(page.getByTestId('quick-capture-input')).toHaveValue(/Typing still works/);
});
