#!/usr/bin/env node
// Runs a desk test command with an environment that cannot reach the developer's own Happier:
//   node packages/tests/scripts/desk-env.mjs -- <command> [args...]
// It drops HAPPIER_*, HAPPY_* and EXPO_PUBLIC_* (keeping the HAPPIER_E2E_* and HAPPY_E2E_* test switches), gives the run a
// fresh HAPPIER_HOME_DIR, and stops the UI export from falling back to a running Metro server.
// startUiWeb and startServerLight pass process.env to their children, so this is the one place
// the scrub happens.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESK_ENV_KEEP, scrubEnv } from '../src/testkit/deskTest/originGuard.ts';

const args = process.argv.slice(2);
const command = args[0] === '--' ? args.slice(1) : args;
if (command.length === 0) {
  console.error('usage: desk-env.mjs -- <command> [args...]');
  process.exit(2);
}

const env = scrubEnv(process.env, DESK_ENV_KEEP);
env.HAPPIER_HOME_DIR = mkdtempSync(join(tmpdir(), 'happier-desk-test-'));
env.HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO = '0';

const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', env });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
