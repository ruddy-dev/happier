// @ts-check
// The desk journeys: system Chrome, no browser downloads, against the export `yarn desk:export` built.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'suites/ui-e2e',
  testMatch: /\/desk\.(j\d+|guard)\.spec\.ts$/,
  globalSetup: './scripts/desk-global-setup.mjs',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 240_000,
  reporter: [['list']],
  outputDir: '.project/logs/e2e/ui-playwright-desk',
  use: {
    testIdAttribute: 'data-testid',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 90_000,
    launchOptions: { executablePath: '/usr/bin/google-chrome', headless: true, args: ['--disable-gpu'] },
    contextOptions: { reducedMotion: 'reduce' },
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
