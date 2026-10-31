# The Ignore Previous overlay

This fork is Happier's latest stable release plus a small overlay: the `/desk` screen (working name **Sleeper Agents**, by Ignore Previous), an "Ignore Previous" theme, and one strings namespace. Upstream code is changed as little as possible, so each new stable release merges in with few conflicts.

## Where the overlay lives

| What | Where |
|---|---|
| Screen, components, model and palette | `apps/ui/sources/ignorePrevious/` (new folder) |
| Route | `apps/ui/sources/app/(app)/desk/index.tsx` (new, thin) |
| Theme profile | `apps/ui/sources/theme/profiles/ignorePreviousThemeProfile.ts` (new), registered in two upstream files |
| Strings | an `ignorePrevious: { … }` block at the end of every locale in `apps/ui/sources/text/translations/` |
| Upkeep tooling | `scripts/overlay/` (new) |

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
   yarn vitest run --config vitest.config.ts sources/ignorePrevious sources/theme sources/text sources/components/settings/appearance/themeProfiles
   ```

4. Open a draft PR into `overlay` and try `/desk` in the browser before merging.

## Strings

All overlay text lives in the `ignorePrevious` block of `en.ts`. Happier's integrity test requires every locale to have the same keys, so after editing `en.ts`, run `node scripts/overlay/syncOverlayStrings.mjs`. It copies the block into the other 11 locale files, which carry the English text. `zh-Hant.ts` is built from `zh-Hans` with overrides, so it inherits the block and the script leaves it alone.

The overlay is English-only by design. `apps/ui/sources/text/i18n.integrity.test.ts` lists `ignorePrevious.` among its allowed untranslated prefixes, so the English copies don't fail the untranslated-strings check.

## Build settings

Optional, in `apps/ui/.env.local` (gitignored). Restart `yarn web` after changing them.

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_IP_COORDINATOR_PATH` | Folder the coordinator session runs in. The desk picks the newest active session there when you haven't chosen one. |
| `EXPO_PUBLIC_IP_AUTOCOMPACT_CLAUDE` | Tokens at which Claude Code auto-compacts (its `autoCompactWindow`, e.g. `220000`). The context bars fill towards this. |
| `EXPO_PUBLIC_IP_AUTOCOMPACT_CODEX` | The same for Codex (`model_auto_compact_token_limit`, e.g. `150000`). |

Without an auto-compact value, the bars measure against the model's context window.

## Patched upstream files

Everything else the overlay adds lives in new files under `apps/ui/sources/ignorePrevious/`, the `/desk` route,
`ignorePreviousThemeProfile.ts` and `scripts/overlay/`, so it can't conflict with upstream. These upstream files
are edited and are where a merge can conflict. From `node scripts/overlay/upstreamCheck.mjs` against
`ui-web-v0.2.19` (18 files):

| File | Why |
|---|---|
| `README.md` | Overlay notice, licence and AI disclosure at the top. |
| `apps/ui/sources/text/translations/{en,ca,de,es,fr,it,ja,pl,pt,ru,zh-Hans}.ts` | The `ignorePrevious` string block (see Strings). |
| `apps/ui/sources/text/i18n.integrity.test.ts` | Allows the English-only `ignorePrevious.` prefix. |
| `apps/ui/sources/theme/profiles/themeProfileTypes.ts` | Adds `ignorePrevious` and `ignorePreviousLight` to the preset id union. |
| `apps/ui/sources/theme/profiles/builtInThemeProfiles.ts` | Registers the two presets (one per mode, as upstream's pickers only offer a preset in its own mode's slot): the dark one after the dark community presets, the light one at the end. |
| `apps/ui/sources/theme/profiles/builtInThemeProfiles.test.ts` | Upstream's exact preset-list assertion gains the two ids. |
| `apps/ui/sources/components/settings/appearance/themeProfiles/themeProfileSettingsScreens.test.tsx` | Upstream's exact list of the theme dropdown's ids gains the two ids. |
| `apps/ui/sources/theme/profiles/communityBuiltInThemeProfiles.ts` | Narrows its preset type so the overlay presets keep their `ignorePrevious.*` translation keys instead of upstream's `settingsAppearance.themeProfiles.presets.*` template. |

When a merge conflicts in one of these, keep upstream's change and re-apply the overlay line.
