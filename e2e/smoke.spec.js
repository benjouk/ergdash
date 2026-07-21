// One shallow pass through the real app in a real browser: log in, see the
// dashboard render seeded data, open a session, see its charts. This is a
// tripwire for "everything unit-tests green but the page is broken", not a
// feature test suite.
import { test, expect } from '@playwright/test';

test('logs in, renders the dashboard, and opens a session with charts', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  // mock-login sets a real session cookie and redirects to /.
  await page.goto('/auth/mock-login');
  await expect(page).toHaveTitle('Dashboard · ErgDash');

  // Top-level page structure is keyboard-navigable and does not advertise
  // listbox behavior that the disclosure menus do not implement.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.getByRole('link', { name: 'Skip to main content' }).click();
  await expect(page.locator('main#main-content')).toBeFocused();
  await expect(page.locator('main h1')).toHaveText('Dashboard');
  await page.getByRole('button', { name: 'Last 30d' }).click();
  await expect(page.locator('[role="listbox"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Last 30d' })).toBeFocused();

  // The feed sidebar lists seeded sessions once /api/workouts responds.
  const feed = page.locator('aside[aria-label="Recent Sessions"]');
  const sessionLinks = feed.locator('a[href^="/session/"]');
  await expect(sessionLinks.first()).toBeVisible();
  expect(await sessionLinks.count()).toBeGreaterThan(3);

  // Dashboard main content renders at least one real chart. Icons are svg
  // too, so anchor on recharts' wrapper, not on bare `svg`.
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();
  await expect(page.getByText(/Training calendar for the last 12 months:/)).toBeAttached();
  await expect(page.locator('svg[aria-hidden="true"] title').first()).toBeAttached();

  // Open the most recent session and expect its detail view with loaded
  // data: the "<time> Row" heading and splits table only render once
  // /api/workouts/:id succeeds, and the pace chart is recharts again — the
  // error state's icons must not satisfy any of these.
  await sessionLinks.first().click();
  await expect(page).toHaveURL(/\/session\/-?\d+/);
  await expect(page).toHaveTitle('Session · ErgDash');
  await expect(page.locator('main h1')).toHaveText(/Row$/);
  await expect(page.getByText(/^(Splits|Intervals)$/).first()).toBeVisible();
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();

  // A white screen or broken chunk shows up here even if the DOM checks pass.
  expect(pageErrors).toEqual([]);
});

test('switches profiles in-app and reloads profile-scoped data', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error));
  await page.goto('/auth/mock-login');
  await expect(page.getByTitle('Profile: Alex')).toBeVisible();

  const beforeHref = await page.locator('aside[aria-label="Recent Sessions"] a[href^="/session/"]').first().getAttribute('href');
  expect(beforeHref).toMatch(/^\/session\/1\d+/);

  const documentMarker = `profile-switch-${Date.now()}`;
  await page.evaluate(marker => { window.__ergdashDocumentMarker = marker; }, documentMarker);
  const switchedApiRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) switchedApiRequests.push(url);
  });

  await page.getByTitle('Profile: Alex').click();
  await page.getByRole('button', { name: /Sam/ }).click();

  await expect(page.getByTitle('Profile: Sam')).toBeVisible();
  await expect(page.locator('aside[aria-label="Recent Sessions"] a[href^="/session/"]').first()).toHaveAttribute('href', /^\/session\/3\d+/);
  expect(await page.evaluate(() => window.__ergdashDocumentMarker)).toBe(documentMarker);

  const activeProfileId = await page.evaluate(() => localStorage.getItem('ergdash_profile'));
  expect(activeProfileId).toBeTruthy();
  expect(switchedApiRequests.length).toBeGreaterThan(0);
  expect(switchedApiRequests.every(url => url.searchParams.get('_ergdash_profile') === activeProfileId)).toBe(true);
  expect(switchedApiRequests.filter(url => url.pathname === '/api/settings')).toHaveLength(1);
  expect(switchedApiRequests.filter(url => url.pathname === '/api/stats/summary')).toHaveLength(1);

  // Profile-independent routes stay put, and switching back can reuse the
  // still-fresh profile-scoped cache without reviving Sam's rows.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(switchedApiRequests.filter(url => url.pathname === '/api/settings')).toHaveLength(1);
  await page.getByTitle('Profile: Sam').click();
  await page.getByRole('button', { name: /Alex/ }).click();
  await expect(page.getByTitle('Profile: Alex')).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('aside[aria-label="Recent Sessions"] a[href^="/session/"]').first()).toHaveAttribute('href', /^\/session\/1\d+/);
  expect(await page.evaluate(() => window.__ergdashDocumentMarker)).toBe(documentMarker);
  expect(pageErrors).toEqual([]);
});
