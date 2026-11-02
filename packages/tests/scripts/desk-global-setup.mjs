// Records which Chrome and playwright-core a desk run used, from the browser itself.
import { createRequire } from 'node:module';

import { chromium } from 'playwright-core';

export default async function deskGlobalSetup(config) {
  const { executablePath, args } = config.projects[0].use.launchOptions;
  const browser = await chromium.launch({ executablePath, headless: true, args });
  const version = browser.version();
  await browser.close();
  const core = createRequire(import.meta.url)('playwright-core/package.json').version;
  console.log(`desk run: chrome ${version} (${executablePath}), playwright-core ${core}`);
}
