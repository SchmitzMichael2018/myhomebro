import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const database = process.env.MHB_EDITORIAL_PREVIEW_DB;
const screenshotDirectory = fileURLToPath(new URL('../../qa-artifacts/', import.meta.url));
const loader = fileURLToPath(new URL('./support/read_contractor_drafts.py', import.meta.url));
const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3');
const pythonArgs = process.platform === 'win32' && python === 'py' ? ['-3.13'] : [];
const drafts = database
  ? JSON.parse(execFileSync(python, [...pythonArgs, loader, database], { encoding: 'utf8' }))
  : [];

const guideCases = [
  ['contractor-payment-plan', 'Set up your project and payment milestones', 'payment_milestones', 'Scope', 'Payment outcome'],
  ['contractor-deposit-vs-milestones', 'Plan the whole payment schedule', 'payment_schedule', 'Startup need', 'Final payment step'],
  ['contractor-change-orders', 'Keep scope changes connected to the agreement', 'scope_changes', 'Pause', 'Agreed work'],
];

test.skip(!database, 'Set MHB_EDITORIAL_PREVIEW_DB to the dedicated local migrated preview database.');

for (const [slug, ctaTitle, intent, firstStep, lastStep] of guideCases) {
  for (const [device, width] of [['desktop', 1280], ['mobile', 390]]) {
    test(`${slug} saved draft preview at ${device} width`, async ({ page }) => {
      const draft = drafts.find((row) => row.slug === slug);
      expect(draft?.publication_status).toBe('draft');
      expect(draft?.problem).toBeTruthy();
      expect(draft?.evidence).toBeTruthy();
      expect(draft?.viewpoint).toBeTruthy();
      await page.setViewportSize({ width, height: device === 'mobile' ? 900 : 1000 });
      await page.addInitScript(() => localStorage.setItem('access', 'synthetic-admin-token'));
      await page.route('**/api/projects/whoami/', (route) =>
        route.fulfill({ status: 200, json: { id: 1, type: 'admin', role: 'admin' } })
      );
      await page.route(`**/api/projects/admin/improvements/preview/${slug}/`, (route) =>
        route.fulfill({ status: 200, json: draft })
      );
      await page.goto(`/app/admin/improvements/preview/${slug}?utm_source=editorial_review`);
      await expect(page.getByRole('heading', { level: 1, name: draft.title })).toBeVisible();
      await expect(page.getByText(draft.problem)).toBeVisible();
      await expect(page.getByText(draft.evidence)).toBeVisible();
      await expect(page.getByText(draft.viewpoint)).toBeVisible();
      await expect(page.getByRole('link', { name: 'MyHomeBro home' })).toBeVisible();
      const logoBox = await page.getByRole('link', { name: 'MyHomeBro home' }).boundingBox();
      const logoHit = await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('a')?.getAttribute('aria-label'),
        { x: logoBox.x + 20, y: logoBox.y + logoBox.height / 2 }
      );
      expect(logoHit).toBe('MyHomeBro home');
      await expect(page.getByRole('link', { name: /Back to Improvement Library/ })).toHaveAttribute('href', '/improvements/');
      await expect(page.getByRole('heading', { name: ctaTitle })).toBeVisible();
      await expect(page.getByTestId('contractor-visual-example')).toContainText(firstStep);
      await expect(page.getByTestId('contractor-visual-example')).toContainText(lastStep);
      await expect(page.getByTestId('walkthrough-placement')).toBeVisible();
      await expect(page.getByTestId('walkthrough-video')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

      // The authenticated shell scrolls inside a fixed-height workspace. Paint
      // the whole LibraryShell at once so off-screen sections are not blank.
      const shell = page.locator('article').locator('xpath=../../..');
      const shellHeight = await shell.evaluate((element) => element.scrollHeight);
      await page.setViewportSize({ width, height: shellHeight + 40 });
      mkdirSync(screenshotDirectory, { recursive: true });
      await shell.screenshot({
        path: `${screenshotDirectory}/improvement-${slug}-${device}.png`,
      });

      if (device === 'desktop') {
        await page.getByRole('button', { name: /Sign up to/ }).click();
        const destination = new URL(page.url());
        expect(destination.pathname).toBe('/signup');
        expect(destination.searchParams.get('article')).toBe(slug);
        expect(destination.searchParams.get('intent')).toBe(intent);
        expect(destination.searchParams.get('utm_source')).toBe('editorial_review');
        const continuation = new URL(destination.searchParams.get('next'), destination.origin);
        expect(continuation.pathname).toBe(draft.canonical_path);
        expect(continuation.searchParams.get('intent')).toBe(intent);
        expect(continuation.searchParams.get('utm_source')).toBe('editorial_review');
      }
    });
  }
}
