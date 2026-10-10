import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:8770',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: {
    command: 'node tools/serve.mjs 8770',
    url: 'http://127.0.0.1:8770',
    reuseExistingServer: false,
  },
});
