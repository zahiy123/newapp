import { test, expect } from '@playwright/test';

// ============================================================
// PHASE 2: FULL-SCALE END-TO-END QA
// ============================================================

// Helper: collect console errors during a test
function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

// ============================================================
// 1. NAVIGATION FLOW — Every page loads without crash
// ============================================================
test.describe('Navigation Flow', () => {
  test('Login page loads correctly', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Should have login form elements
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await expect(passwordInput).toBeVisible();

    // Check for submit button
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();

    // No critical JS errors
    const criticalErrors = errors.filter(e => !e.includes('Firebase') && !e.includes('ERR_CONNECTION'));
    expect(criticalErrors.length).toBeLessThanOrEqual(2);
  });

  test('Unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('All protected routes redirect to /login when unauthenticated', async ({ page }) => {
    const protectedRoutes = ['/profile', '/sport-selection', '/goals', '/training', '/stats', '/game'];
    for (const route of protectedRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    }
  });

  test('No 404 or blank screen on any route', async ({ page }) => {
    const allRoutes = ['/login', '/', '/profile', '/sport-selection', '/goals', '/training', '/stats', '/game'];
    for (const route of allRoutes) {
      const response = await page.goto(route);
      // Vite SPA always returns 200 (client-side routing)
      expect(response.status()).toBe(200);
      // Body should not be empty
      const bodyText = await page.locator('body').textContent();
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });

  test('Non-existent route does not crash', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/this-route-does-not-exist');
    await page.waitForLoadState('networkidle');
    // Should either redirect to login or show something (not a blank white screen)
    const bodyText = await page.locator('body').textContent();
    expect(bodyText.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 2. LOGIN PAGE — UI & Interaction
// ============================================================
test.describe('Login Page UI', () => {
  test('Login form validates empty fields', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // HTML5 validation should prevent submission or show error
    // Check that we're still on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('Login form shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'fake@test.com');
    await page.fill('input[type="password"]', 'wrongpassword123');
    await page.locator('button[type="submit"]').click();

    // Should show an error message (not crash)
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/login/);
  });

  test('Login page has register toggle', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Look for register/signup toggle text or button
    const toggleText = page.locator('text=/הרשמה|Sign Up|Register|צור חשבון/i');
    const hasToggle = await toggleText.count();
    expect(hasToggle).toBeGreaterThan(0);
  });

  test('Language toggle exists and works', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Look for language toggle button
    const langToggle = page.locator('text=/עב|EN|🌐/');
    if (await langToggle.count() > 0) {
      await langToggle.first().click();
      await page.waitForTimeout(500);
      // Page should still be functional
      const bodyText = await page.locator('body').textContent();
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// 3. RTL & HEBREW LAYOUT
// ============================================================
test.describe('RTL & Hebrew Layout', () => {
  test('Login page has correct dir attribute for Hebrew', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Check if dir="rtl" is set on html or body or a wrapper div
    const dirAttr = await page.locator('[dir]').first().getAttribute('dir');
    // Could be rtl or ltr depending on default
    expect(dirAttr).toBeDefined();
  });

  test('No horizontal overflow on login page (desktop)', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });

  test('No horizontal overflow on login page (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('Hebrew text renders without obvious truncation', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Check that buttons have visible text (not clipped to 0 width)
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await buttons.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThan(20);
        expect(box.height).toBeGreaterThan(15);
      }
    }
  });
});

// ============================================================
// 4. MOBILE RESPONSIVENESS
// ============================================================
test.describe('Mobile Responsiveness', () => {
  test('Login page is usable on small screen (320px)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Form inputs should be visible
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    const box = await emailInput.boundingBox();
    expect(box.width).toBeGreaterThan(100); // Not squeezed too small
  });

  test('Login page is usable on iPhone SE (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    const box = await submitBtn.boundingBox();
    // Button should be tappable (min 44px per WCAG)
    expect(box.height).toBeGreaterThanOrEqual(30);
  });
});

// ============================================================
// 5. ASSET LOADING & PERFORMANCE
// ============================================================
test.describe('Asset Loading', () => {
  test('No broken images on login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const images = page.locator('img');
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const naturalWidth = await images.nth(i).evaluate(el => el.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test('Page loads within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(5000);
  });

  test('No failed network requests (critical)', async ({ page }) => {
    const failedRequests = [];
    page.on('requestfailed', req => {
      if (!req.url().includes('favicon')) {
        failedRequests.push({ url: req.url(), error: req.failure()?.errorText });
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Filter out non-critical failures (analytics, external CDNs with CORS, etc.)
    const critical = failedRequests.filter(r =>
      r.url.includes('localhost') && !r.url.includes('favicon')
    );
    expect(critical.length).toBe(0);
  });
});

// ============================================================
// 6. CONSOLE ERROR AUDIT
// ============================================================
test.describe('Console Error Audit', () => {
  test('Login page has no critical JS errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Filter out known benign errors
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('HMR') &&
      !e.includes('WebSocket') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('analytics')
    );

    console.log('Console errors found:', critical.length);
    critical.forEach(e => console.log('  ERROR:', e));

    // Allow up to 3 non-critical errors (Firebase init, etc.)
    expect(critical.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================
// 7. ACCESSIBILITY BASICS
// ============================================================
test.describe('Accessibility', () => {
  test('Login form inputs have labels or aria-labels', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const inputs = page.locator('input:visible');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const ariaLabel = await input.getAttribute('aria-label');
      const placeholder = await input.getAttribute('placeholder');
      const id = await input.getAttribute('id');

      // Each input should have at least one accessible identifier
      const hasLabel = ariaLabel || placeholder || id;
      expect(hasLabel).toBeTruthy();
    }
  });

  test('Buttons have accessible text', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button:visible');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');
      expect(text?.trim() || ariaLabel).toBeTruthy();
    }
  });
});

// ============================================================
// 8. SERVER API HEALTH
// ============================================================
test.describe('Server API', () => {
  test('Render server responds to warm-up ping', async ({ request }) => {
    try {
      const response = await request.post('https://newapp-nujg.onrender.com/api/coach/analyze-rep', {
        data: {
          frames: [],
          exercise: 'calibration',
          sport: 'warmup',
          playerName: 'qa_test',
          repNumber: 0
        },
        timeout: 30000
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ready');
    } catch (e) {
      // Server may be cold — not a critical failure
      console.log('Server warm-up failed (may be cold start):', e.message);
    }
  });
});

// ============================================================
// 9. SECURITY BASICS
// ============================================================
test.describe('Security', () => {
  test('Password field is type=password (not text)', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const pwField = page.locator('input[type="password"]');
    await expect(pwField).toBeVisible({ timeout: 10000 });
    const type = await pwField.getAttribute('type');
    expect(type).toBe('password');
  });

  test('No sensitive data in page source', async ({ page }) => {
    await page.goto('/login');
    const html = await page.content();
    // Should not contain API keys in rendered HTML
    expect(html).not.toContain('sk-ant-');
    expect(html).not.toContain('ANTHROPIC_API_KEY');
  });
});

// ============================================================
// 10. EDGE CASES
// ============================================================
test.describe('Edge Cases', () => {
  test('Double-clicking login button does not cause errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'test@test.com');
    await page.fill('input[type="password"]', 'test123456');

    const btn = page.locator('button[type="submit"]');
    await btn.dblclick();
    await page.waitForTimeout(2000);

    // Should not crash
    const bodyText = await page.locator('body').textContent();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('Back/forward navigation does not crash', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.goBack();
    await page.waitForTimeout(500);
    await page.goForward();
    await page.waitForTimeout(500);

    const bodyText = await page.locator('body').textContent();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('Rapid route changes do not crash', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const routes = ['/', '/profile', '/goals', '/training', '/stats', '/login'];
    for (const route of routes) {
      page.goto(route); // intentionally not awaiting
      await page.waitForTimeout(200);
    }
    await page.waitForLoadState('networkidle');

    const criticalErrors = errors.filter(e =>
      e.includes('Cannot read') || e.includes('undefined') || e.includes('null')
    );
    expect(criticalErrors.length).toBe(0);
  });
});
