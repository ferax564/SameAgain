import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5174);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Apply drizzle/ migrations to the local D1 state, then start the Vite dev
    // server (Worker runtime via @cloudflare/vite-plugin) against it.
    command: `node scripts/e2e-setup.mjs && npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      WRANGLER_LOG_PATH: '.wrangler/wrangler.log',
    },
  },
});
