// Browser smoke test against the production topology: Express serving the
// built client, seeded demo data, real session cookie via /auth/mock-login.
// Run `npm run build` in client/ first; global-setup copies the build into
// server/dist the way the Dockerfile does.
import { defineConfig } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3399;

export default defineConfig({
  testDir: __dirname,
  globalSetup: join(__dirname, 'global-setup.mjs'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Escape hatch for environments with a system-managed Chromium
      // (sandboxes, NixOS) where `playwright install` is unavailable.
      executablePath: process.env.ERGDASH_E2E_CHROMIUM || undefined,
    },
  },
  webServer: {
    command: 'node server.js',
    cwd: join(__dirname, '..', 'server'),
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATA_DIR: join(__dirname, '.data'),
      // Demo season of workouts to render, and mock-login enabled (any
      // non-production NODE_ENV) so no Concept2 credentials are needed.
      ERGDASH_SEED_DEMO: '1',
      // Keep the test server from calling out to Concept2 rankings.
      ERGDASH_RANKINGS_LIVE: '0',
    },
  },
});
