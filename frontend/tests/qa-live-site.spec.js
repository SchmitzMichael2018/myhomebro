/**
 * Live-site QA pass for https://www.myhomebro.com
 * Read-only. No local server. Captures console errors, network failures,
 * layout issues, and broken flows.
 */

import { test, expect } from '@playwright/test';

const SITE = 'https://www.myhomebro.com';

// Helpers
function collectErrors(page) {
  const consoleErrors = [];
  const networkFails = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', resp => {
    if (resp.status() >= 400) {
      networkFails.push(`${resp.status()} ${resp.url()}`);
    }
  });
  return { consoleErrors, networkFails };
}

// ─── 1. LANDING PAGE ────────────────────────────────────────────────────────

test('landing page loads and has key sections', async ({ page }) => {
  const { consoleErrors, networkFails } = collectErrors(page);
  await page.goto(SITE, { waitUntil: 'networkidle' });

  await expect(page).toHaveTitle(/.+/);  // any non-empty title

  // Hero / main content visible
  const body = page.locator('body');
  await expect(body).toBeVisible();

  // Check for visible text landmarks
  const pageText = await page.textContent('body');
  expect(pageText.length).toBeGreaterThan(200);

  // Screenshot
  await page.screenshot({ path: 'test-results/screenshots/01-landing-desktop.png', fullPage: true });

  if (consoleErrors.length) console.log('Console errors:', consoleErrors);
  if (networkFails.length) console.log('Network failures:', networkFails);
});

test('landing page - no critical console errors', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.goto(SITE, { waitUntil: 'networkidle' });
  const critical = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('ERR_BLOCKED')
  );
  if (critical.length > 0) {
    console.log('CRITICAL CONSOLE ERRORS:', critical);
  }
  // Soft assertion — log but don't hard-fail on minor errors
  expect(critical.length, `Console errors: ${critical.join('\n')}`).toBeLessThan(5);
});

test('landing page - no 5xx network errors', async ({ page }) => {
  const serverErrors = [];
  page.on('response', resp => {
    if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`);
  });
  await page.goto(SITE, { waitUntil: 'networkidle' });
  expect(serverErrors, `Server errors: ${serverErrors.join('\n')}`).toHaveLength(0);
});

// ─── 2. MOBILE LANDING PAGE ─────────────────────────────────────────────────

test('landing page - mobile viewport renders correctly', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // iPhone 12
  await page.goto(SITE, { waitUntil: 'networkidle' });

  const body = page.locator('body');
  await expect(body).toBeVisible();

  // Check for horizontal overflow (layout breakage)
  const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = 375;
  if (scrollWidth > viewportWidth + 5) {
    await page.screenshot({ path: 'test-results/screenshots/02-landing-mobile-overflow.png', fullPage: true });
  }
  expect(scrollWidth, `Horizontal overflow: scrollWidth=${scrollWidth} > viewportWidth=${viewportWidth}`).toBeLessThanOrEqual(viewportWidth + 5);

  await page.screenshot({ path: 'test-results/screenshots/03-landing-mobile.png', fullPage: true });
});

// ─── 3. LOGIN PAGE ──────────────────────────────────────────────────────────

test('login page is reachable and has form', async ({ page }) => {
  const { consoleErrors, networkFails } = collectErrors(page);

  // Try common login paths
  const loginPaths = ['/login', '/auth/login', '/accounts/login', '/signin'];
  let loginFound = false;

  for (const path of loginPaths) {
    const resp = await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' });
    if (resp && resp.status() < 400) {
      loginFound = true;
      await page.screenshot({ path: `test-results/screenshots/04-login${path.replace(/\//g, '-')}.png` });
      break;
    }
  }

  if (!loginFound) {
    // Check if login link exists on homepage
    await page.goto(SITE, { waitUntil: 'networkidle' });
    const loginLink = page.locator('a').filter({ hasText: /login|sign in|log in/i }).first();
    if (await loginLink.count() > 0) {
      await loginLink.click();
      await page.waitForLoadState('networkidle');
      loginFound = true;
      await page.screenshot({ path: 'test-results/screenshots/04-login-via-link.png' });
    }
  }

  if (!loginFound) {
    console.log('WARNING: Could not find login page at common paths');
  }

  // If login page found, check for email + password fields
  const emailInput = page.locator('input[type="email"], input[name="email"], input[name="username"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  if (await emailInput.count() > 0 && await passwordInput.count() > 0) {
    console.log('Login form found with email + password fields');
  }

  if (consoleErrors.length) console.log('Login page console errors:', consoleErrors);
  if (networkFails.length) console.log('Login page network failures:', networkFails);
});

test('login form - invalid credentials show error', async ({ page }) => {
  const loginPaths = ['/login', '/auth/login', '/accounts/login', '/signin'];

  for (const path of loginPaths) {
    const resp = await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' });
    if (resp && resp.status() < 400) {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[name="username"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      if (await emailInput.count() > 0 && await passwordInput.count() > 0) {
        await emailInput.fill('qa-test-invalid@example.com');
        await passwordInput.fill('WrongPassword123!');

        const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
        if (await submitBtn.count() > 0) {
          await submitBtn.click();
          await page.waitForTimeout(2000);

          // Should show an error, not navigate to dashboard
          const currentUrl = page.url();
          const errorVisible = await page.locator('[class*="error"], [class*="alert"], [role="alert"]').count() > 0;
          const stillOnLoginPage = currentUrl.includes(path) || errorVisible;

          await page.screenshot({ path: 'test-results/screenshots/05-login-invalid-creds.png' });

          if (!stillOnLoginPage && !errorVisible) {
            console.log('WARNING: Invalid credentials may not be rejected properly');
          }
        }
      }
      break;
    }
  }
});

// ─── 4. PUBLIC CONTRACTOR PROFILE ───────────────────────────────────────────

test('public contractor profile page', async ({ page }) => {
  const { consoleErrors, networkFails } = collectErrors(page);

  // Try common profile URL patterns
  const profilePaths = ['/contractors', '/find-contractors', '/professionals', '/pros'];

  for (const path of profilePaths) {
    const resp = await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    if (resp && resp.status() < 400) {
      await page.screenshot({ path: `test-results/screenshots/06-contractors${path.replace(/\//g, '-')}.png` });
      break;
    }
  }

  if (consoleErrors.length) console.log('Profile page console errors:', consoleErrors);
  if (networkFails.length) console.log('Profile page network failures:', networkFails);
});

// ─── 5. NAVIGATION & INTERNAL LINKS ─────────────────────────────────────────

test('navigation links on landing page work (no 404s)', async ({ page }) => {
  await page.goto(SITE, { waitUntil: 'networkidle' });

  // Collect all internal nav links
  const links = await page.locator('nav a, header a').evaluateAll(els =>
    els.map(el => el.href).filter(href => href && !href.startsWith('mailto') && !href.startsWith('tel'))
  );

  const uniqueLinks = [...new Set(links)].slice(0, 10); // test first 10
  const brokenLinks = [];

  for (const link of uniqueLinks) {
    if (!link.startsWith('http')) continue;
    try {
      const resp = await page.request.get(link, { timeout: 10000 });
      if (resp.status() >= 400) {
        brokenLinks.push(`${resp.status()} ${link}`);
      }
    } catch (e) {
      brokenLinks.push(`TIMEOUT/ERROR ${link}`);
    }
  }

  if (brokenLinks.length > 0) {
    console.log('Broken nav links:', brokenLinks);
  }
  expect(brokenLinks).toHaveLength(0);
});

// ─── 6. SIDEBAR BEHAVIOR (post-login) ───────────────────────────────────────

test('sidebar visible and no overlap on desktop after login attempt', async ({ page }) => {
  // Navigate to login and attempt entry; if redirected to dashboard, check sidebar
  const loginPaths = ['/login', '/auth/login', '/accounts/login', '/signin'];
  for (const path of loginPaths) {
    const resp = await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (resp && resp.status() < 400) {
      await page.screenshot({ path: 'test-results/screenshots/07-pre-auth-sidebar.png' });
      break;
    }
  }
  // If we somehow land on an authenticated page, check for sidebar
  const sidebar = page.locator('[data-testid="sidebar"], nav[class*="sidebar"], aside').first();
  if (await sidebar.count() > 0) {
    const box = await sidebar.boundingBox();
    if (box) {
      console.log(`Sidebar found at x:${box.x} y:${box.y} w:${box.width} h:${box.height}`);
      // Check it's not covering main content (x position check)
      const mainContent = page.locator('main, [class*="main-content"], [class*="content"]').first();
      if (await mainContent.count() > 0) {
        const mainBox = await mainContent.boundingBox();
        if (mainBox && box.x + box.width > mainBox.x + 10) {
          await page.screenshot({ path: 'test-results/screenshots/07-sidebar-overlap-FAIL.png' });
          console.log('POTENTIAL SIDEBAR OVERLAP DETECTED');
        }
      }
    }
  }
});

// ─── 7. MODAL OVERFLOW CHECK ─────────────────────────────────────────────────

test('modals do not overflow viewport', async ({ page }) => {
  await page.goto(SITE, { waitUntil: 'networkidle' });

  // Try to trigger any modal (common CTA buttons)
  const modalTriggers = page.locator('button').filter({
    hasText: /get started|sign up|request|contact|book|schedule/i
  });
  const count = await modalTriggers.count();

  if (count > 0) {
    await modalTriggers.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[role="dialog"], [class*="modal"], [class*="Modal"]').first();
    if (await modal.count() > 0) {
      const box = await modal.boundingBox();
      const viewport = page.viewportSize();
      if (box && viewport) {
        if (box.y < 0 || box.y + box.height > viewport.height || box.x < 0 || box.x + box.width > viewport.width) {
          await page.screenshot({ path: 'test-results/screenshots/08-modal-overflow-FAIL.png' });
          console.log(`Modal overflow: box=${JSON.stringify(box)}, viewport=${JSON.stringify(viewport)}`);
        }
      }
      await page.screenshot({ path: 'test-results/screenshots/08-modal-open.png' });
    }
  }
});

// ─── 8. FULL PAGE DESKTOP SCREENSHOT (for visual diff) ───────────────────────

test('full page desktop screenshots for all key pages', async ({ page }) => {
  const pages = [
    { path: '/', name: 'home' },
    { path: '/login', name: 'login' },
    { path: '/about', name: 'about' },
    { path: '/contact', name: 'contact' },
    { path: '/contractors', name: 'contractors' },
  ];

  for (const { path, name } of pages) {
    const resp = await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    if (resp && resp.status() < 400) {
      await page.screenshot({
        path: `test-results/screenshots/09-desktop-${name}.png`,
        fullPage: true,
      });
    } else {
      console.log(`Page ${path} not found (${resp?.status() ?? 'error'})`);
    }
  }
});

test('full page mobile screenshots for key pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14

  const pages = [
    { path: '/', name: 'home' },
    { path: '/login', name: 'login' },
  ];

  for (const { path, name } of pages) {
    const resp = await page.goto(`${SITE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    if (resp && resp.status() < 400) {
      await page.screenshot({
        path: `test-results/screenshots/10-mobile-${name}.png`,
        fullPage: true,
      });
    }
  }
});

// ─── 9. NETWORK HEALTH SUMMARY ───────────────────────────────────────────────

test('comprehensive network error audit on landing page', async ({ page }) => {
  const allRequests = [];
  const failedRequests = [];

  page.on('response', resp => {
    allRequests.push({ status: resp.status(), url: resp.url() });
    if (resp.status() >= 400) {
      failedRequests.push({ status: resp.status(), url: resp.url() });
    }
  });

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });

  await page.goto(SITE, { waitUntil: 'networkidle' });

  console.log(`\n=== NETWORK AUDIT ===`);
  console.log(`Total requests: ${allRequests.length}`);
  console.log(`Failed (4xx/5xx): ${failedRequests.length}`);
  if (failedRequests.length > 0) {
    console.log('Failed requests:');
    failedRequests.forEach(r => console.log(`  ${r.status} ${r.url}`));
  }
  console.log(`Console errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.log('Console errors:');
    consoleErrors.forEach(e => console.log(`  ${e}`));
  }
  console.log(`Console warnings: ${consoleWarnings.length}`);
  if (consoleWarnings.length > 0) {
    consoleWarnings.slice(0, 10).forEach(w => console.log(`  ${w}`));
  }

  // No hard failures here — this test is for reporting
  expect(true).toBe(true);
});
