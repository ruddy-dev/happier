// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'suites/ui-e2e',
  // The desk specs need system Chrome and their own export: playwright.desk.config.mjs.
  testIgnore: /\/desk\.(j\d+|guard)\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '.project/logs/e2e/ui-playwright-lane-j',
  use: {
    testIdAttribute: 'data-testid',
    viewport: { width: 390, height: 844 },
    actionTimeout: 15_000,
    navigationTimeout: 90_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
