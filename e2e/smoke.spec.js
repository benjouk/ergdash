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

  // The feed sidebar lists seeded sessions once /api/workouts responds.
  const feed = page.locator('aside[aria-label="Recent Sessions"]');
  const sessionLinks = feed.locator('a[href^="/session/"]');
  await expect(sessionLinks.first()).toBeVisible();
  expect(await sessionLinks.count()).toBeGreaterThan(3);

  // Dashboard main content renders at least one real chart. Icons are svg
  // too, so anchor on recharts' wrapper, not on bare `svg`.
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();

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
