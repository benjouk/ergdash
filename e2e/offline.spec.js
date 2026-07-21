// The offline promise, verified: once the service worker controls the page,
// a full reload with the network down must still produce a working dashboard
// from the precached shell and cached API reads.
import { test, expect } from '@playwright/test';

test('keeps cached offline data isolated between profiles', async ({ page, context }) => {
  await page.goto('/auth/mock-login');
  await expect(page).toHaveTitle('Dashboard · ErgDash');
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();

  // Wait for the worker to finish installing and take control of the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
      );
    }
  });

  // One controlled online pass so the runtime cache holds the API responses
  // (requests made before the worker took control bypassed it).
  await page.reload();
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();
  const feed = page.locator('aside[aria-label="Recent Sessions"]');
  await expect(feed.locator('a[href^="/session/"]').first()).toHaveAttribute('href', /^\/session\/1\d+/);

  // Warm Sam's separately keyed API responses, then prove a controlled
  // offline reload resolves Sam's cache rather than Alex's header-blind data.
  await page.getByTitle('Profile: Alex').click();
  await page.getByRole('button', { name: /Sam/ }).click();
  await expect(page.getByTitle('Profile: Sam')).toBeVisible();
  await expect(feed.locator('a[href^="/session/"]').first()).toHaveAttribute('href', /^\/session\/3\d+/);

  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('Dashboard · ErgDash');
  await expect(page.getByTitle('Profile: Sam')).toBeVisible();
  await expect(feed.locator('a[href^="/session/"]').first()).toHaveAttribute('href', /^\/session\/3\d+/);
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();

  // The in-app switch also works offline after the reload, using Alex's own
  // cached URLs and never leaving Sam's workout rows on screen.
  await page.getByTitle('Profile: Sam').click();
  await page.getByRole('button', { name: /Alex/ }).click();
  await expect(page.getByTitle('Profile: Alex')).toBeVisible();
  await expect(feed.locator('a[href^="/session/"]').first()).toHaveAttribute('href', /^\/session\/1\d+/);
  await context.setOffline(false);
});
