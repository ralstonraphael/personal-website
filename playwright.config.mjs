import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '*.spec.mjs',
  outputDir: 'test-results/artifacts',
  timeout: 10_000,
  expect: { timeout: 3_000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/static-server.mjs',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
  },
});
