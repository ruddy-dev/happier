# The Ignore Previous overlay

This fork is Happier's latest stable release plus a small overlay: the `/desk` screen (working name **Sleeper Agents**, by Ignore Previous), an "Ignore Previous" theme, and one strings namespace. Upstream code is changed as little as possible, so each new stable release merges in with few conflicts.

## Where the overlay lives

| What | Where |
|---|---|
| Screen, components, model and palette | `apps/ui/sources/ignorePrevious/` (new folder) |
| Routes | `apps/ui/sources/app/(app)/desk/index.tsx` and `apps/ui/sources/app/(app)/desk/settings.tsx` (new, thin) |
| Theme profile | `apps/ui/sources/theme/profiles/ignorePreviousThemeProfile.ts` (new), registered in two upstream files |
| Strings | an `ignorePrevious: { … }` block at the end of every locale in `apps/ui/sources/text/translations/` |
| Upkeep tooling | `scripts/overlay/` (new) |
| Composer seam | `apps/ui/sources/components/sessions/model/{sessionComposerOverrides,composerRequests}.ts` (new), wired into `SessionView.tsx` |
| Dev-only desk fixture (screenshots, landing-page demo) | `apps/ui/sources/app/(app)/dev/desk-fixture.tsx` (route), `apps/ui/sources/ignorePrevious/fixtures/` (scenario, store seeding and the stub coordinator body), `apps/ui/scripts/ipFixtureShots.mjs` (shots in system Chrome), `scripts/overlay/ipFixtureShipGuard.mjs` (all new) |
| Desk test harness | `apps/ui/sources/ignorePrevious/testkit/` (scenario driver and JSON scripts); in the UI testkit, `mocks/reducedMotion.ts` and `mocks/sync.ts`; `apps/ui/sources/dev/vitestOriginGuard.ts`; in `packages/tests`, `src/testkit/deskTest/`, `scripts/desk-env.mjs` and `suites/core-e2e/permissions.lifecycle.plain.test.ts` (all new) |

Desk text must use `DeskText` (or `DESK_FONT_STACK` from `ignorePrevious/fonts/deskFont.ts`): Happier `Text` sets Inter/Plex inline, and portaled content (Popover, Modal) does not inherit the root.

The development desk build also opts the web sign-in branch at `/`, `/restore/manual` (secret-key restore), and `/settings/voice` into `ignorePrevious/appearance/DeskPageAppearance.tsx`. Each wrapped screen retains its scope while mounted; each dialog captures its appearance when opened. The scope retains the existing refcounted font installation until it unmounts. Its exact route list extends the existing font installer; named Unistyles scopes reuse the Ignore Previous light/dark profiles without writing the user's global theme preference. The app's Text/TextInput owner reads the local scope so explicit Inter/Plex styles cannot override JetBrains Mono. Restore/Voice navigation headers, the shared modal host, and web popover/dialog portals carry the same scope. Sign-in keeps its appearance inside its page so navigation options cannot leak into authenticated Home. Authenticated Home, general Settings, sessions, other restore routes, and native screens keep their existing appearance. The onboarding planet artwork retains its existing art palette. Terminal transcript palettes remain transcript-only. The secret-key backup banner's behavior is unchanged.

Desk preferences live in `ignorePrevious/deskPrefs.ts`, per device in MMKV (browser storage on web), with no account sync. The typed owner retains the existing coordinator and panel storage keys; `creatureEnabled` defaults to on without writing on mount. The fixture coordinator override remains in memory. `/desk/settings` uses the desk font and provides the settings shell and About notice; the desk top bar supplies its Settings button. The desk route hides the shared stack header via its own `Stack.Screen` option and supplies its own chrome.

## Branches

- `stable-base`: the upstream stable tag in use. It only ever moves forward to a newer stable tag.
- `overlay`: `stable-base` plus the overlay. It's the branch to build and run.
- Work branches start from `overlay`. Each one goes back in through a draft pull request **inside this fork**:

  ```bash
  gh pr create --draft --repo ruddy-dev/happier --base overlay
  ```

  Without `--repo` and `--base`, GitHub targets happier-dev/happier.

Upstream marks stable releases with immutable tags such as `ui-web-v0.2.19`, plus a rolling `ui-web-stable` tag that points at the newest one. The overlay follows the web UI's stable tag. The server and CLI are upstream's and aren't built from this fork.

## Taking a new stable release

1. Check for a new release:

   ```bash
   git remote add upstream https://github.com/happier-dev/happier.git   # once
   git remote add fork https://github.com/ruddy-dev/happier.git          # once
   git switch overlay
   node scripts/overlay/upstreamCheck.mjs
   ```

   The script prints the tag in use, the newest stable tag, and the upstream files the overlay patches. If there's a newer tag, it test-merges it in a throwaway worktree and reports `clean` or the conflicting paths. It never pushes or moves a branch.

2. If there's a new tag, move `stable-base` to it, then merge it on a fresh branch:

   ```bash
   git push fork <new-tag>^{commit}:refs/heads/stable-base
   git switch -c upstream-<new-tag> overlay
   git merge <new-tag>
   ```

   Merge, never rebase, so `overlay` is never force-pushed. Resolve any conflicts in the patched files listed below.

3. Re-run the string sync and the checks:

   ```bash
   node scripts/overlay/syncOverlayStrings.mjs
   node --test scripts/overlay/*.test.mjs
   cd apps/ui && yarn typecheck
   yarn vitest run --config vitest.config.ts sources/ignorePrevious sources/theme sources/text sources/components/settings/appearance/themeProfiles sources/dev/vitestOriginGuard.test.ts sources/dev/testkit/mocks/mockFactories.test.ts sources/sync/ops/sessions.permissionDeny.test.ts sources/sync/ops/__tests__/sessionAbort.test.ts sources/sync/ops/sessions.permissionResult.test.ts sources/components/sessions/model/sessionComposerOverrides.test.tsx sources/components/sessions/model/composerRequests.test.tsx sources/components/sessions/shell/SessionView.composerSeam.test.tsx sources/auth/routing/authRouting.test.ts sources/dev/metro.config.ipFixtures.spec.ts sources/dev/ipFixtureImports.spec.ts
   node --test scripts/ipFixtureShots.test.mjs
   cd ../../packages/tests && yarn typecheck
   node --test src/testkit/deskTest/originGuard.test.mjs
   ```

4. Re-check the ship guard: a cold export without `EXPO_PUBLIC_IP_FIXTURES` (`expo export --clear`, or a fresh `TMPDIR`), then `node scripts/overlay/ipFixtureShipGuard.mjs <export-dir>` must pass, and the same guard on a flag-on export must fail (see "The desk fixture").

5. Open a draft PR into `overlay` and try `/desk` in the browser before merging.

## Strings

All overlay text lives in the `ignorePrevious` block of `en.ts`. Happier's integrity test requires every locale to have the same keys, so after editing `en.ts`, run `node scripts/overlay/syncOverlayStrings.mjs`. It copies the block into the other 11 locale files, which carry the English text. `zh-Hant.ts` is built from `zh-Hans` with overrides, so it inherits the block and the script leaves it alone.

The overlay is English-only by design. `apps/ui/sources/text/i18n.integrity.test.ts` lists `ignorePrevious.` among its allowed untranslated prefixes, so the English copies don't fail the untranslated-strings check.

## Coordinator transcript appearance (development)

`/desk/settings` stores this device's chat style and Terminal palette in the desk preference store.
Mask slips is the default: Happier message layout, the desk font, and the existing mask on agent replies.
Terminal uses Tokyo Midnight by default, with Kanagawa Dragon, Gruvbox Hard, Dracula and Paper as choices.
The five palettes reuse `ignorePrevious/palette.ts`; only the coordinator transcript receives their styles.
The nullable upstream `TranscriptAppearanceContext` leaves ordinary sessions unchanged. Its optional
markdown colours keep text and inline surfaces together, including Paper on a dark Happier theme.
Tool containers accept the style, while tool-row text retains its existing fonts and colours.

The stored `thinkingAndTools` preference defaults to `reply-link` (one quiet link per reply), with `hidden`
as the other value. It has no settings row or runtime reader in this slice; C17 owns the transcript filter.

## Build settings

Optional, in `apps/ui/.env.local` (gitignored), except `EXPO_PUBLIC_IP_FIXTURES`, which belongs in a one-off shell environment, never in `.env.local` (see "The desk fixture"). Restart `yarn web` after changing any of them, `EXPO_PUBLIC_IP_FIXTURES` included: `metro.config.js` reads that flag once at start-up, and a running server that sees it change at runtime would load a fixture its block list has hidden.

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_IP_COORDINATOR_PATH` | Folder the coordinator session runs in. The desk picks the newest active session there when you haven't chosen one. |
| `EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE` | Tokens at which Claude Code auto-compacts (its `autoCompactWindow`, e.g. `220000`). The context bars fill towards this. |
| `EXPO_PUBLIC_IP_AUTOCOMPACT_CODEX` | The same for Codex (`model_auto_compact_token_limit`, e.g. `150000`). |

Without an auto-compact value, the bars measure against the model's context window.

### The desk fixture

`EXPO_PUBLIC_IP_FIXTURES=1` builds in the dev-only route `/dev/desk-fixture`: the real desk over five made-up sessions written into the store, with no account and no server. The coordinator's chat is replaced by a fixed transcript on that route only (Happier's chat needs an account). It runs signed out only: with credentials or an account profile present it shows a notice and seeds nothing, because the store feeds a signed-in account's session list and warm cache. It never writes the stored coordinator choice (an in-memory override in `deskPrefs` stands in), and it removes its sessions from the store when the route is left or credentials arrive. Sync releases the fixture synchronously before activating an account's warm-cache scope, and the session-state owner removes the batch and its projections before saving once. A late fixture import checks the current account scope before seeding. Without the flag the route redirects to `/`, the public-route line in `authRouting.ts` is off, and `metro.config.js` blocks `ignorePrevious/fixtures/` so none of it can be bundled. Set the flag only for a screenshot or demo build, and only in the environment of that command (`EXPO_PUBLIC_IP_FIXTURES=1 expo export ...`). Don't put it in `apps/ui/.env.local`: `expo export` and `expo start` load that file, so a flag left there would turn the fixture on for every build on the machine.

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_IP_FIXTURES` | `1` builds in the fixture route and stub. Anything else leaves it out. |
| `HAPPIER_METRO_EXTRA_WATCH_FOLDERS` | Folders Metro should also watch, separated by the platform path delimiter (`:` on Linux and macOS, `;` on Windows). Off unless set. A git worktree that links another checkout's `node_modules` needs it, or `expo export` fails with "Failed to get the SHA-1". |

Fixture imports stay optional. A dev bundle (`expo start`, `expo export --dev`) does not fold the flag check away, so with the fixtures folder blocked it would fail to resolve the fixture imports. Both dynamic imports (`desk-fixture.tsx`, `CoordinatorPane.tsx`) therefore sit inside a `try` block, which Metro treats as an optional dependency; `sources/dev/ipFixtureImports.spec.ts` keeps it that way. Don't hoist them out of the `try`.

Ship guard. A normal build must carry no fixture. After a **cold** export without the flag, run `node scripts/overlay/ipFixtureShipGuard.mjs <export-dir>`. It exits 0 when clean, 1 if any file holds the fixture marker or one of four strings that a flag-on build carries outside the fixtures folder (the fixtures import path, the stub import path, the public-route check, the loader's error), and 2 when the folder is not a finished web export (no `index.html`, unsupported HTML, anything other than exactly one actual entry script under `_expo/static/js/web/`, or any missing local script; comments do not count as script elements). Cold means a fresh Metro cache: Metro's transform cache key ignores `EXPO_PUBLIC_*` values, so an export that reuses a flag-on cache keeps the public route and the stub import in its bundle even though the block list now drops the marker; the four extra strings catch that. Build the guard's export with `expo export --clear`, or give it a fresh `TMPDIR` (Metro keeps its cache there) and delete `metro-file-map-*` first (`~/dev/tools/happier-wt/export.sh` keeps one cache per set of `EXPO_PUBLIC_*` values). Positive control: run the same guard on a flag-on export once; it must exit 1, or a pass on the flag-off export could be vacuous. To shoot the flag-on build: `cd apps/ui && node scripts/ipFixtureShots.mjs <flag-on-export-dir> <out-dir>`.

## Patched upstream files

Everything else the overlay adds lives in the new files listed under "Where the overlay lives", so it can't
conflict with upstream. These upstream files are edited and are where a merge can conflict. From
`node scripts/overlay/upstreamCheck.mjs` against `ui-web-v0.2.19` (31 files: 20 for the overlay itself, 8 for the desk test harness, 3 for the desk fixture):

| File | Why |
|---|---|
| `apps/ui/sources/app/(app)/index.tsx` | ATR-55 redirects the ordinary authenticated web root to `/desk` only when there are no query parameters and no pending terminal connection. Any root query, including server overrides, legacy `url`/`auto` links and unrelated parameters, keeps its existing owner. Native redirect behavior, signed-out welcome, session links, non-root URLs and the existing Tauri setup/home branch are preserved. Component coverage lives in `ignorePrevious/screens/startPage.test.tsx`. |
| `apps/ui/sources/components/navigation/shell/SidebarNavigator.tsx` | Hides the shared sidebar on the desk route; coverage lives beside it in `SidebarNavigator.collapsed.test.tsx`. |
| `apps/ui/sources/components/sessions/transcript/TranscriptAppearanceContext.tsx` (new) | Nullable data/slot contract for user, agent and tool containers, optional markdown font/colours and an agent-leading node; imports no overlay code. |
| `apps/ui/sources/components/sessions/transcript/MessageView.tsx` | Applies opt-in container styles after built-ins and the agent-leading slot; styles the streaming plain-text fallback. Resets the appearance beneath tool chrome to preserve tool-row typography. |
| `apps/ui/sources/components/sessions/pending/PendingMessagesTranscriptBlock.tsx` | Resets transcript appearance for queued-message markdown on the stock Happier bubble. |
| `apps/ui/sources/components/markdown/enriched/useEnrichedMarkdownStyle.ts` | Opt-in font and coordinated markdown colours, including emphasis and inline/code/table surfaces. The default builder inputs remain unchanged. |
| `apps/ui/sources/components/markdown/MarkdownBlockView.tsx` | Applies typed optional font/colour overrides to the block renderer, including nested spans, lists, options and tables; retains the upstream static stylesheet without a provider. |
| `apps/ui/sources/keyboard/escape.ts` | Exports the existing editable-target predicate so the desk popup hook uses the keyboard owner's rule instead of duplicating it. |
| `apps/ui/sources/components/sessions/usageLimitRecovery/sessionUsageLimitRecoveryPresentation.ts` | Exports the existing issue predicate, visibility decision and reset reader so Work cards reuse SessionView's rules without a second parser. Recovery predicate bodies are unchanged; the desk's armed claim excludes paused recovery. |
| `apps/ui/sources/modal/components/BaseModal.tsx` | Registers a modal-priority Escape blocker while visible on web so desk popups yield keyboard and outside clicks to real dialogs, including the command palette. Side effect: `MultiPaneHost` skips its own Esc handling while a blocker above pane priority is registered, so while a modal is visible, Esc no longer closes an overlay pane or details view; the modal's own handler still gets the key. |
| `apps/ui/sources/components/ui/popover/Popover.tsx` | Marks portaled web content with `data-happy-popover-content` so desk popups leave menu interactions to Popover. |
| `apps/ui/public/ignore-previous/fonts/jetbrains-mono-latin.woff2`, `apps/ui/public/ignore-previous/fonts/OFL.txt` | Local JetBrains Mono web asset and its standalone SIL OFL licence. Expo serves public assets; the desk-owned installer applies weights 500–700 only while a listed route is mounted. |
| `README.md` | Overlay notice, licence and AI disclosure at the top. |
| `apps/ui/sources/text/translations/{en,ca,de,es,fr,it,ja,pl,pt,ru,zh-Hans}.ts` | The `ignorePrevious` string block (see Strings). |
| `apps/ui/sources/text/i18n.integrity.test.ts` | Allows the English-only `ignorePrevious.` prefix. |
| `apps/ui/sources/theme/profiles/themeProfileTypes.ts` | Adds `ignorePrevious` and `ignorePreviousLight` to the preset id union. |
| `apps/ui/sources/theme/profiles/builtInThemeProfiles.ts` | Registers the two presets (one per mode, as upstream's pickers only offer a preset in its own mode's slot): the dark one after the dark community presets, the light one at the end. |
| `apps/ui/sources/theme/profiles/builtInThemeProfiles.test.ts` | Upstream's exact preset-list assertion gains the two ids. |
| `apps/ui/sources/components/settings/appearance/themeProfiles/themeProfileSettingsScreens.test.tsx` | Upstream's exact list of the theme dropdown's ids gains the two ids. |
| `apps/ui/sources/dev/vitestSetup.ts` | Installs `vitestOriginGuard`, so no UI unit test can reach the developer's server on port 3005, `*.happier.dev` or `*.ts.net`. The UI can't import from `packages/tests`, so the guard repeats the forbidden list in `packages/tests/src/testkit/deskTest/originGuard.ts`; change both together. |
| `apps/ui/sources/dev/testkit/index.ts` | Exports the two new mocks. |
| `apps/ui/sources/dev/testkit/mocks/mockFactories.test.ts` | Covers the two new mocks. |
| `apps/ui/sources/sync/ops/sessions.permissionDeny.test.ts`, `apps/ui/sources/sync/ops/__tests__/sessionAbort.test.ts` | Use the shared `@/sync/sync` stub instead of their own inline mocks. |
| `packages/tests/src/testkit/syntheticAgent/syntheticAgent.ts` | The synthetic agent can run a plain-mode session and send `update-state` (agentState plus the activity summary the server counts requests from). |
| `packages/tests/src/testkit/socketClient.ts`, `packages/tests/suites/core-e2e/rpc.permissionRoundtrip.test.ts` | RPC `params` and replies are typed `unknown`, as plain sessions send raw JSON rather than base64 ciphertext. |
| `apps/ui/sources/theme/profiles/communityBuiltInThemeProfiles.ts` | Narrows its preset type so the overlay presets keep their `ignorePrevious.*` translation keys instead of upstream's `settingsAppearance.themeProfiles.presets.*` template. |
| `apps/ui/sources/sync/ops/sessions.ts` | Adds `sessionAllowResult` and `sessionDenyResult`, which return the CLI's answer instead of dropping it. `sessionAllow` and `sessionDeny` call them and keep their `void` behaviour. Adds `sessionAbortResult` for honest Desk failures without local thinking recovery; legacy `sessionAbort` preserves its void semantics through one shared recovery helper. |
| `apps/ui/sources/auth/routing/authRouting.ts`, `authRouting.test.ts` | One line makes `dev/desk-fixture` public for signed-out users, only in a build with `EXPO_PUBLIC_IP_FIXTURES=1`; the test covers it on and off. |
| `apps/ui/sources/sync/store/domains/sessions.ts` | Adds `deleteSessions` at the existing deletion owner; single deletion delegates to it, and a batch saves the warm cache only after all sessions and projections are removed. |
| `apps/ui/sources/sync/store/types.ts` | Exposes the additive batch-deletion method on the public store interface. |
| `apps/ui/sources/sync/sync.ts` | Fixture-flag-only synchronous cleanup before both account-scope activation paths (`create` and `restore`); no fixture data import or persistence filtering. ATR-44 adds mounted record-consumer ids to required snapshot hydration and shares the existing record-only exact loader with deduped late registrations (four concurrent record requests). Record-only failures log without rejecting the snapshot; explicit and organization requirements still throw. Append pages add no record demand; ordinary replace snapshots reuse loaded records, while resume refreshes them and changes catch-up supplies changed ids as explicit requirements. `hydrateRequiredSessionRecord` now returns early per record on missing credentials/encryption, so the snapshot can still advance its cursor; ids that are both organization-required and record consumers share the four-request limiter and dedupe. Sessions without a record consumer retain upstream hydration eligibility and transcript behavior. |
| `apps/ui/sources/sync/engine/sessions/sessionSnapshot.ts` | ATR-44 adds optional `softRequiredHydrationSessionIds` for in-page record-consumer-only rows. The existing required-row gate waits for these rows, logs and counts a thrown row hydration error as terminal, and continues the snapshot. Pinned, attention, explicit and organization-required overlaps remain hard requirements at the sync caller. Omitting the option keeps upstream rejection behavior. |
| `apps/ui/sources/sync/engine/socket/socket.ts` | ATR-44 routes retained record consumers through full-record metadata, agent-state and pending-count application, without starting transcript catch-up on control return. ATR-46 starts a detached observer after normal message materialization is registered for both new and updated messages. Claude desk record consumers parse delivered plaintext events or reuse `SessionEncryption.decryptRaw` without populating the shared decrypted-message cache. Only confirmed mode/sequence and the published-mode/lifetime check are retained in memory, cleared on last release and invalidated by published-mode changes. Observer decode/schema/decrypt failures log a content-free message through the existing logger; observation never gates routing or settlement. No history fetch or transcript hydration is added. Sessions without a record consumer retain upstream routing and hidden-record behavior. |
| `apps/ui/sources/sync/engine/socket/socket.updateSession.plaintext.test.ts` | ATR-44 adds record-only updates and concurrent hidden-nonconsumer coverage; the original retained-hidden regression is unchanged. Sessions without a record consumer behave as upstream. |
| `apps/ui/sources/sync/runtime/sessionLiveConsumption.ts` | ATR-44 adds the canonical `isRecordConsumer` decision, respecting suppression and leaving full-content consumption unchanged. Sessions without a record consumer behave as upstream. |
| `apps/ui/sources/sync/runtime/sessionLiveConsumption.test.ts` | ATR-44 extends existing result-shape assertions with `isRecordConsumer: false`; sessions without a record consumer behave as upstream. |
| `apps/ui/sources/sync/runtime/sessionRealtimeRecordConsumers.ts` | ATR-44 adds a server-scoped, refcounted mount registry, an indexed membership lookup, a test-clear function and change listeners with import-cycle-safe storage. It grants record demand only; sessions without a record consumer behave as upstream. |
| `apps/ui/sources/sync/runtime/sessionRealtimeRecordConsumers.test.ts` | ATR-44 covers refcounts, server isolation, notifications and suppression; sessions without a record consumer retain upstream full-content decisions. |
| `apps/ui/sources/sync/sync.recordConsumers.test.ts` | ATR-44 exercises real snapshot/exact-fetch orchestration with fake HTTP responses, including late-load dedupe, four-request concurrency and no retry until membership changes. It checks that a nonconsumer snapshot row retains upstream unloaded behavior, that in-page desk-only failures settle once and advance pagination while pinned/attention/explicit failures reject, and that changed catch-up ids refresh without extra reads for unchanged loaded consumers. |
| `apps/ui/metro.config.js` | Two seams: `HAPPIER_METRO_EXTRA_WATCH_FOLDERS` adds watch folders (off unless set), and a `resolver.blockList` entry drops `ignorePrevious/fixtures/` unless `EXPO_PUBLIC_IP_FIXTURES=1`. |
| `apps/ui/sources/components/tools/shell/permissions/permissionActionDispatchGuard.ts` | Adds `holdAfterSuccess`, default true to preserve the session footer; the desk opts out of shared settlement after success while keeping in-flight arbitration. |
| `apps/ui/sources/components/tools/shell/permissions/permissionActionDispatchGuard.test.ts` | Covers the option with a retained footer request and release on cleanup. |
| `apps/ui/sources/components/sessions/agentInput/AgentInput.tsx` | Optional `footerLeadingActions` is inserted at the start of the tools row from the shared action-footer renderer, including collapsed layouts and both web/native branches. Undefined leaves the upstream composer unchanged. The footer View exposes `testID="agent-input-action-footer"` for placement checks. Opt-in `sendIsStop` gives Stop the submit position even with a draft, using the existing abort handler and restoring text-input focus; `hideAbortButton` hides only the secondary Stop. Abort presses share an in-flight guard. Plain composers retain their normal Send/mic/Stop selection. |
| `apps/ui/sources/components/sessions/model/sessionComposerOverrides.ts` | Threads the optional footer-leading slot through the existing composer override resolver. Opt-in `sendIsStop` retains the existing abort callback when `hide.stop` hides the secondary button, and is disabled for read-only sessions. Without it, `hide.stop` retains its existing behavior. |
| `apps/ui/sources/components/sessions/shell/SessionView.composerSeam.test.tsx` | Verifies the stock session header remains by default and can be hidden by a host, the footer-leading override reaches AgentInput alongside the existing status actions, and Send-as-Stop retains SessionView's existing abort path while hiding the secondary Stop and mic. |
| `apps/ui/sources/components/sessions/shell/SessionView.tsx` | Takes an optional `showHeader` prop (defaults to shown; the desk hides it and its spacing) and `composer` prop (placeholder, extra chips and badges, trailing status actions, leading footer actions, gauge and mic replacement, Send-as-Stop, hiding stop and context usage) and registers the composer with the request bus, so the desk can fill or focus it. Without the prop it behaves as upstream. |
| `apps/ui/sources/sync/ops/__tests__/sessionAbortResult.test.ts` | Covers result-bearing abort failures, success recovery, error propagation and legacy compatibility at the RPC boundary. |
| `apps/ui/sources/app/(app)/index.tsx` | ATR-56 wraps only the unauthenticated sign-in branch in `DeskPageAppearance`; authenticated Home is unchanged. Sign-in explicitly disables scoped stack-header options. |
| `apps/ui/sources/app/(app)/restore/manual.tsx` | ATR-56 wraps the existing secret-key restore content in the opt-in appearance scope; recovery, reveal and authentication behavior remain upstream-owned. |
| `apps/ui/sources/app/(app)/settings/voice.tsx` | ATR-56 adds the opt-in appearance wrapper around the existing Voice settings content. |
| `apps/ui/sources/components/ui/text/Text.tsx` | ATR-56 appends the existing desk font stack to Text and TextInput only inside the local appearance context; scaling, selection and unrelated fonts remain unchanged. |
| `apps/ui/sources/unistyles.web.ts` | ATR-56 registers two named scopes derived from the existing Ignore Previous profiles; leaves the global light/dark preference and startup selection unchanged. |
| `apps/ui/sources/unistyles.ts` | ATR-56 registers the same names for consistent Unistyles types, but no native page opts in; native startup selection is unchanged. |
| `apps/ui/sources/unistyles.startup.test.ts` | ATR-56 includes the named desk scopes in startup registration coverage while retaining exact canonical base-theme fallback and checking that the selected startup theme stays light. |
| `apps/ui/sources/components/ui/popover/portal.tsx` | ATR-56 re-establishes the active desk page's CSS theme scope inside web portals; without a desk context the wrapper is inert. Native portal behavior is unchanged. |
| `apps/ui/sources/components/appShell/providers/AppPaneModalProvider.tsx` | ATR-56 supplies the desk page appearance wrapper for modal content; pane and modal ownership remain unchanged. |
| `apps/ui/sources/modal/ModalProvider.tsx` | ATR-56 adds an optional content wrapper around mounted dialogs, defaulting to a fragment. The wrapper is keyed per dialog so each captures its opening appearance independently. Registration, focus return, visibility and dismissal stay with the existing provider. |
| `apps/ui/sources/modal/components/BaseModal.tsx` | ATR-56 re-establishes the active desk scope inside the Radix web portal; native dialogs and unscoped pages are unchanged. |
| `apps/ui/sources/dev/testkit/mocks/unistyles.ts`, `apps/ui/sources/dev/vitestSetup.ts` | ATR-56 adds a `ScopedTheme` passthrough to both Unistyles test mocks (the testkit factory and the global setup mock) so tests that render a desk-scoped page or dialog keep working; it renders its children unchanged. |
| `packages/tests/package.json` | Adds `desk:export` and `desk:test`, plus the pinned `playwright-core` development dependency for the system-Chrome journey runner. |
| `packages/tests/playwright.ui.config.mjs` | Excludes `desk.*.spec.ts`; desk journeys run only under the desk config and its request guard. |
| `packages/tests/playwright.ui.lane-j.config.mjs` | Excludes `desk.*.spec.ts` from the upstream lane-J project for the same reason. |
| `packages/tests/src/testkit/process/uiWebExport.ts` | Exposes the existing cache-current/build owner with an explicit rebuild option and includes the UI's direct `@happier-dev/*` workspace dependencies in its source fingerprint. The UI and shared packages retain the same size/mtime cache owner. |

The desk runner adds overlay-owned files under `packages/tests`: `playwright.desk.config.mjs`, `scripts/desk-{env,global-setup}.mjs`, `scripts/desk-export.ts`, `src/testkit/deskTest/*`, and `suites/ui-e2e/desk.{guard,j1,j2,j3}.spec.ts`. These are new files rather than edits to upstream specs. J1 scopes `ip-issue-<KEY>` to the expanded Work column, including folded Faces cards; the collapsed rail uses `ip-rail-issue-<KEY>`. J2 checks the specific active `ip-waiting-card-<requestId>` root separately from Answered history. Seed setup is inside cleanup scopes, including partially started workers. The guard's shared auto-fixture closes pages while guards remain installed, disposes the context request client to end outstanding fetches, drains tracked HTTP and WebSocket callbacks with a bounded URL-naming failure, then unroutes HTTP and reports refusals and non-closure errors; browser-free tests drive that exact fixture body. Redirect probes include an empty-Location repeat hop. `yarn desk:export --rebuild` bypasses the existing completed export caches. Before an actual export, `desk-export.ts` deletes only `metro-file-map-*` entries inside its private Metro temp directory and keeps the transform cache.

When a merge conflicts in one of these, keep upstream's change and re-apply the overlay line.
