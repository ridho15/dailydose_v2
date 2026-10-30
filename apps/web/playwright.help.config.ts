import { defineConfig, devices } from '@playwright/test';

const playwrightPort = process.env.DD_PLAYWRIGHT_PORT ?? '3010';
const playwrightBaseUrl = `http://localhost:${playwrightPort}`;

export default defineConfig({
  testDir: './e2e/help-screenshots',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: playwrightBaseUrl,
    ...devices['Desktop Chrome'],
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: `NEXT_DIST_DIR=.next-help pnpm exec next dev -p ${playwrightPort}`,
    url: playwrightBaseUrl,
    timeout: 60_000,
    reuseExistingServer: true,
    env: {
      NEXT_PUBLIC_AUTH_SYNTHETIC_ENABLED: 'true',
      API_BASE_URL: 'http://127.0.0.1:32121',
    },
  },
});

