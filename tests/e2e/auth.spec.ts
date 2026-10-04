import { expect, test } from '@playwright/test';

/**
 * Auth flow smoke test.
 *
 * Requires a reachable database (`npm run db:migrate && npm run db:seed`) and
 * a running app. Not part of `npm run verify`, because it depends on external
 * infrastructure; run it explicitly with `npm run test:e2e`.
 */

const email = `e2e-${Date.now()}@opsflow.test`;
const organization = 'E2E Test Org';

test('visiting the app unauthenticated redirects to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('a signed-out visitor cannot read /api/me', async ({ request }) => {
  const response = await request.get('/api/me');
  expect(response.status()).toBe(401);

  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe('UNAUTHENTICATED');
});

test('health endpoint reports database status', async ({ request }) => {
  const response = await request.get('/api/health');
  expect([200, 503]).toContain(response.status());

  const body = (await response.json()) as { data?: unknown; error?: unknown };
  expect(body.data ?? body.error).toBeDefined();
});

test('register, sign in and reach the dashboard', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('E2E Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('Correct-Horse-9');
  await page.getByLabel('Organization name').fill(organization);

  await page.getByRole('button', { name: 'Create account' }).click();
  // Registration creates an account and redirects to the sign-in page. With
  // client-side navigation the URL may change quickly, but in some environments
  // the server render is followed by hydration — wait for the redirect to
  // stabilise rather than asserting it in the same tick.
  await expect(page).toHaveURL(/\/login($|\?)/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Correct-Horse-9');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('No data yet').first()).toBeVisible();

  // Signing out must clear the session.
  await page.getByRole('button', { name: /E2E Tester/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
