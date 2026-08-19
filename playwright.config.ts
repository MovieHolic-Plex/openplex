import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './client/test',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:33888',
    trace: 'on-first-retry',
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://127.0.0.1:33888',
          localStorage: [
            {
              name: 'openplex.profileId',
              value: '1',
            },
          ],
        },
      ],
    },
  },
  webServer: process.env.OPENPLEX_MANAGED_SERVER
    ? undefined
    : {
        command: 'npm run start:e2e',
        url: 'http://127.0.0.1:33888/health',
        reuseExistingServer: false,
        timeout: 30_000,
      },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
