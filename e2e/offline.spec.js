// The offline promise, verified: once the service worker controls the page,
// a full reload with the network down must still produce a working dashboard
// from the precached shell and cached API reads.
import { test, expect } from '@playwright/test';

test('serves the dashboard from cache when the network is gone', async ({ page, context }) => {
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

  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('Dashboard · ErgDash');
  const feed = page.locator('aside[aria-label="Recent Sessions"]');
  await expect(feed.locator('a[href^="/session/"]').first()).toBeVisible();
  await expect(page.locator('main .recharts-wrapper svg').first()).toBeVisible();
  await context.setOffline(false);
});
