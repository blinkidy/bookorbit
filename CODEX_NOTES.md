# Codex Notes

This file is a project-local handoff for future Codex sessions working on this fork.

## Repository

- Fork: `blinkidy/bookorbit`
- Upstream: `bookorbit/bookorbit`
- Local workspace: `C:\Users\Warre\Documents\Codex\2026-06-22\https-github-com-blinkidy-bookorbit-this`

## Personalizations To Preserve

- Hardcover book selection support.
- StoryGraph sync.
- Book collection work.
- Personal release/image flow for the `blinkidy/bookorbit` fork.

## Recent Work

### Upstream v1.12.0 update

- Branch used: `update-upstream-v1.12.0`
- PR: `https://github.com/blinkidy/bookorbit/pull/1`
- Status: merged into `main`.
- Purpose: merge upstream BookOrbit `v1.12.0` while preserving the fork's personal changes.

### Automatic image build on merge

- File: `.github/workflows/container-image.yml`
- Added a `push` trigger for `main` so the container image workflow starts automatically after a PR merge.
- The workflow can still be manually run with `workflow_dispatch`; GitHub will continue showing the "Run workflow" button even when automatic triggers exist.

### Daily upstream release check

- Branch: `chore/daily-upstream-release-check`
- PR: `https://github.com/blinkidy/bookorbit/pull/2`
- Status at time of writing: open.
- File added: `.github/workflows/check-upstream-release.yml`
- Purpose: check upstream BookOrbit releases daily and open/update a draft PR when a newer upstream release can be merged into this fork.

### Personal release version in sidebar

- Branch: `fix/personal-release-version-display`
- PR: `https://github.com/blinkidy/bookorbit/pull/3`
- Status at time of writing: open and ready for review.
- Files changed:
  - `.github/workflows/container-image.yml`
  - `.github/workflows/release.yml`
  - `client/src/components/sidebar/versionUi.ts`
  - `client/src/components/sidebar/__tests__/versionUi.spec.ts`
- Purpose: show versions like `v1.0.13-personal` in the app sidebar instead of `sha-...`.
- Behavior: personal release tags link to `https://github.com/blinkidy/bookorbit/releases`, while upstream release tags still link to `https://github.com/bookorbit/bookorbit/releases`.

## Useful Checks

Run these from the repo root when validating similar changes:

```powershell
corepack pnpm exec commitlint --config commitlint.config.cjs --from main --to HEAD --verbose
corepack pnpm exec prettier --check .github/workflows/container-image.yml .github/workflows/release.yml client/src/components/sidebar/versionUi.ts client/src/components/sidebar/__tests__/versionUi.spec.ts
corepack pnpm --filter client exec vitest run src/components/sidebar/__tests__/versionUi.spec.ts
corepack pnpm run typecheck:client
```

## Notes For Future Codex

- At the start of future sessions, check this file and `CLAUDE.md` if present. Treat `CLAUDE.md` as useful project history from Claude, then verify important details against the repo before editing.
- Treat `blinkidy/bookorbit` as the target repo unless the user explicitly asks to operate on upstream.
- Do not push or open PRs against `bookorbit/bookorbit` for this personalization work.
- Check open PRs before starting new workflow/release work; PR #2 and PR #3 may already contain relevant changes.
- If the sidebar still shows `sha-...`, confirm whether the running container image was rebuilt after PR #3 merged. Existing images keep the version baked in at build time.
