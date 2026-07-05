# Build & Release

**Purpose:** How the action is bundled, why `dist/` is gitignored, and how the floating `v1` tag is published by CI.
**Read this when:** You are touching the build, CI workflows, the release flow, husky hooks, or wondering why `dist/` is not in git.

## Build

`pnpm build` runs ncc to bundle the TypeScript entry into a single committed-at-release JS file (`package.json:9`):

```
ncc build src/index.ts --out dist --source-map --license licenses.txt
```

Output of a build:

- `dist/index.js` — the bundle that `action.yml` points at (`action.yml:91`, `main: 'dist/index.js'`).
- `dist/index.js.map` — source map (shipped; see [known-issues](./known-issues.md) D).
- `dist/licenses.txt` — third-party license report.

Toolchain:

- Runtime: GitHub Actions `node24` (`action.yml:90`). Build-time engine constraint is `node >=20` (`package.json:53-55`).
- Package manager is pinned via `packageManager: pnpm@11.5.2` (`package.json:7`). Use pnpm, never npm/yarn. CI installs with `pnpm install --frozen-lockfile`.

## Why `dist/` is gitignored (and how this repo squares it)

GitHub Actions with `using: node24` execute the file at `main:` **directly from the consumer's checkout** — there is no install/build step on the runner. So a JS action normally must commit its bundled `dist/`.

This repo instead keeps `dist/` **gitignored** (`.gitignore:14`) and lets CI own it:

- Feature branches never commit `dist/`. Building locally is only for verifying the bundle compiles.
- The `release-v1` CI job rebuilds `dist/` on every push to `main` and commits it back to `main` (and only `main`).
- Consumers reference `testglance/action@v1` (not a branch), which always resolves to a commit that _does_ contain `dist/`.

See [conventions](./conventions.md) for the "never commit dist from a branch" rule.

## CI workflow (`.github/workflows/ci.yml`)

Triggers: push to `main`, and PRs targeting `main` (`ci.yml:3-7`). Concurrency cancels in-progress runs per ref (`ci.yml:9-11`). All jobs use Node 24 + pnpm.

| Job           | Purpose                                    | Notes           |
| ------------- | ------------------------------------------ | --------------- |
| `lint-format` | `pnpm lint` + `pnpm format:check`          | `ci.yml:14-26`  |
| `typecheck`   | `pnpm typecheck` (`tsc --noEmit`)          | `ci.yml:28-39`  |
| `test`        | run vitest, then build, then **self-test** | `ci.yml:41-65`  |
| `build`       | `pnpm build` (bundle smoke check)          | `ci.yml:67-78`  |
| `release-v1`  | rebuild `dist/`, commit, force-retag `v1`  | `ci.yml:80-117` |

### `test` job self-test

After running vitest (JUnit reporter to `test-results/vitest.xml`), it runs `pnpm build` then invokes the action against itself via `uses: ./` (`ci.yml:59-65`). Both the build and the self-test use `if: always()` so the action runs even when tests failed (it must report failures). The self-test needs the freshly built `dist/` to exist — hence the build step precedes `uses: ./`. Requires `checks: write` + `pull-requests: write` permissions (`ci.yml:44-47`).

### `release-v1` job

Guarded to push-on-`main` only and gated behind the other four jobs (`ci.yml:82-83`):

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
needs: [lint-format, typecheck, test, build]
```

Steps (`ci.yml:85-117`):

1. Mint a **GitHub App token** via `actions/create-github-app-token` (`ci.yml:86-90`) using `REBUILD_BOT_APP_ID` / `REBUILD_BOT_PRIVATE_KEY` secrets. The App token (not `GITHUB_TOKEN`) is required to force-push the tag and to commit to `main` under branch protection.
2. Checkout with `fetch-depth: 0` and the App token (`ci.yml:91-94`).
3. `pnpm install --frozen-lockfile` + `pnpm build` (`ci.yml:100-101`).
4. Commit `dist/` **only if changed** (`ci.yml:102-112`): `git add -f dist/` (force, since gitignored), and if `git diff --cached` is non-empty, commit `chore: rebuild dist [skip ci]` as `testglance-rebuild-bot[bot]` and push to `main`. `[skip ci]` prevents a CI loop.
5. Force-retag (`ci.yml:113-116`): `git tag -f v1 && git push origin v1 --force`.

## Floating `v1` tag

`v1` is a **mutable** major-version tag, force-moved to the latest dist-bearing commit on `main` by `release-v1`. Consumers pin `testglance/action@v1` and automatically receive the newest release without changing their workflow. There are no immutable per-version tags in this flow.

## Husky hooks

`prepare: husky` (`package.json:18`) installs hooks on `pnpm install`.

| Hook         | Runs                                                  | File                    |
| ------------ | ----------------------------------------------------- | ----------------------- |
| `pre-commit` | guards `node_modules` exists, then `pnpm lint-staged` | `.husky/pre-commit:1-5` |
| `commit-msg` | `pnpm commitlint --edit $1`                           | `.husky/commit-msg:1`   |
| `pre-push`   | `pnpm typecheck && pnpm test`                         | `.husky/pre-push:1`     |

`lint-staged` config (`package.json:21-29`):

- `*.{ts,tsx}` → `eslint --fix` then `prettier --write`
- `*.{json,md,css,mjs,js,yml,yaml}` → `prettier --write`

## commitlint

Extends `@commitlint/config-conventional` (`.commitlintrc.json:2`). A custom `headerPattern` (`.commitlintrc.json:5`) allows an **optional non-letter prefix** (e.g. an emoji + space) before the conventional `type(scope)?!: subject`:

```
^(?:[^a-zA-Z]*\s)?(?<type>\w+)(?:\((?<scope>[^)]+)\))?!?:\s(?<subject>.+)$
```

So both `fix: ...` and `✨ feat(parsers): ...` pass.

## postinstall: ESM export patch

`postinstall: node scripts/patch-esm-exports.cjs` (`package.json:19`) runs after every install.

It walks `node_modules/@actions/*/package.json` and, for any package whose `exports['.']` declares `import` but no `require`/`default`, copies `import` into `default` (`scripts/patch-esm-exports.cjs:10-17`). This fixes ncc/CJS-interop resolution so the `@actions/*` packages can be bundled. Without it the bundle can fail to resolve those ESM-only export maps. The patch is idempotent and a no-op when `default` already exists.

## Renovate

`renovate.json` extends `config:recommended`, `helpers:pinGitHubActionDigests` (SHA-pins
all third-party actions and keeps the pins updated), and the `:automergeLinters` /
`:automergeTesters` / `:automergeTypes` presets. Automerge applies to:

- devDependency patch/minor updates (`renovate.json` `packageRules`)
- linter / tester / `@types` updates (the `:automerge*` presets)
- `github-actions` **digest re-pins** + patch/minor tag moves (`renovate.json` `packageRules`)
- `lockFileMaintenance`

Automerge does **not** apply to production `dependencies` - the packages ncc bundles into
`dist/` - which carry an explicit `automerge: false` rule and require human review.
`:automergePatch` (which previously covered prod-dep patches) and `:automergeDigest` were
removed for this reason.

`minimumReleaseAge: "3 days"` and `internalChecksFilter: "strict"` gate all updates. The
first Renovate run after enabling `helpers:pinGitHubActionDigests` opens a one-time "Pin
dependencies" PR (updateType `pin`) that is **not** auto-merged and is reviewed once. This
posture was hardened in [#159](https://github.com/testglance/action/issues/159) — see
[known-issues](./known-issues.md) B and [security](./security.md).

## Related

- [conventions](./conventions.md) — dist/pnpm/commit rules.
- [testing](./testing.md) — vitest + the `uses: ./` self-test.
- [known-issues](./known-issues.md) — B (automerge) and D (shipped source map).
