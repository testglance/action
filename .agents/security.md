# Security

**Purpose:** How secrets, tokens, and the published bundle are handled from a security standpoint.
**Read this when:** You are touching auth, tokens, permissions, or anything that could leak a secret or affect supply-chain trust.

## Secret inventory

| Secret                                           | Source                                                                             | Where used                                                         | Scope / sensitivity                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `api-key`                                        | `core.getInput('api-key')` (`src/index.ts:143`)                                    | `Authorization: Bearer ${apiKey}` header in `src/api/client.ts:89` | TestGlance project key. Optional.                           |
| `github-token`                                   | `core.getInput('github-token') \|\| process.env.GITHUB_TOKEN` (`src/index.ts:153`) | PR comments + check runs (Octokit)                                 | Scoped GitHub token; least-privilege per workflow.          |
| `REBUILD_BOT_APP_ID` / `REBUILD_BOT_PRIVATE_KEY` | `secrets.*` in CI                                                                  | `release-v1` job only (`.github/workflows/ci.yml:88-90`)           | GitHub App creds for committing `dist/` and retagging `v1`. |

There are **no hardcoded secrets** anywhere in `src/`. `api-url` defaults to `https://www.testglance.dev` (`action.yml:16`, fallback `src/index.ts:150`) and is configurable.

## api-key handling

- Read once via `core.getInput('api-key')` (`src/index.ts:143`). Empty string when absent.
- `const localOnly = !apiKey` (`src/index.ts:144`): no api-key ⇒ **local-only mode**. `sendResults` is forced `false` (`src/index.ts:154`) so the API is never called; summary / PR comment / check run / HTML report still run. See [api-client](./api-client.md).
- The only use of the key is the `Bearer` header in `src/api/client.ts:89`. It is **never logged** — no `core.info`/`warning`/`debug` call interpolates `apiKey`, and API error handlers (`src/utils/errors.ts:24-26`) log only the server's `code - message`, never the key.
- In workflows the key arrives as `${{ secrets.TESTGLANCE_API_KEY }}` (`.github/workflows/ci.yml:62`). GitHub automatically masks registered secret values in logs, so even an accidental echo is redacted.
- The key currently gates a reserved SaaS feature — `action.yml:10` marks it "reserved … currently inactive." Treat it as a real secret regardless.

## github-token handling

- Needed **only** for the two GitHub API outputs:
  - **PR comments** — `postPrComment` (`src/index.ts:478-520`). Requires `pull-requests: write`.
  - **Check runs / inline annotations** — `createCheckRun` (`src/index.ts:462-476`), gated by `annotate-failures`. Requires `checks: write`.
- If `annotate-failures` is requested without a token, the action warns and skips rather than failing (`src/index.ts:473-475`).
- Falls back to `process.env.GITHUB_TOKEN` so `${{ github.token }}` works without explicit wiring.

### Least-privilege permissions

Consumers should grant only what they use. The repo's own workflows model this:

- `test` job — `contents: read`, `checks: write`, `pull-requests: write` (`.github/workflows/ci.yml:44-47`); it runs `uses: ./` with `annotate-failures: true`.
- `e2e` job — `pull-requests: write` only (`.github/workflows/e2e.yml:17-18`); no check runs there.
- `lint-format`, `typecheck`, `build` jobs declare **no** `permissions` block — they need none.

Guidance for downstream users:

| Feature used                    | Minimum permission     |
| ------------------------------- | ---------------------- |
| Summary only / API submit only  | none (default read)    |
| PR comments                     | `pull-requests: write` |
| `annotate-failures` (check run) | `checks: write`        |

## Environment variables (context, not secrets)

`buildPayload` (`src/api/client.ts:39-68`) and `run()` read `GITHUB_*` context vars — `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_REF_NAME`, `GITHUB_RUN_ID`, `GITHUB_WORKFLOW`, `GITHUB_JOB`, `GITHUB_HEAD_REF`, `GITHUB_BASE_REF`, `GITHUB_SERVER_URL`. These are public CI context, **not credentials**, and are sent to the API as run metadata. Do not add secret-bearing env vars to the payload.

## Local config files are gitignored

`.gitignore:7-8` ignores `.env` and `.env.*` (with `!.env.example` un-ignored, `.gitignore:9`). No real secret should ever be committed; only `.env.example` placeholders.

## Supply-chain / provenance

The published artifact is `dist/index.js` — a single `@vercel/ncc` bundle. Trust model:

- `dist/` is **gitignored** (`.gitignore:14`) and never committed from feature branches.
- It is built and committed to `main` **only** by the `release-v1` job, authenticated with a **GitHub App token** minted at job time from `REBUILD_BOT_APP_ID` / `REBUILD_BOT_PRIVATE_KEY` (`.github/workflows/ci.yml:86-94`). Commit author is `testglance-rebuild-bot[bot]` (`.github/workflows/ci.yml:104-105`).
- `release-v1` runs only on push to `main` and only after `lint-format`, `typecheck`, `test`, `build` pass (`.github/workflows/ci.yml:82-83`).
- The job **force-retags `v1`** to the new commit (`git tag -f v1; git push origin v1 --force`, `.github/workflows/ci.yml:114-116`). Consumers reference `testglance/action@v1`, a floating tag — they trust whatever bundle `v1` currently points at. There is no immutable pinning by default. See [build-and-release](./build-and-release.md).

### Supply-chain warts

- **Source map no longer shipped** (was a wart, now fixed — [#161](https://github.com/testglance/action/issues/161)). `pnpm build` dropped `--source-map`, so the published `dist/` ships only `index.js` + `licenses.txt` (no `index.js.map`, no `sourcemap-register.js`). `pnpm build:debug` still emits the map for local bundle debugging but is never used by `release-v1`, so nothing ships to consumers — see [known-issues](./known-issues.md#d).
- **Renovate automerges patch/minor.** `renovate.json` sets `automerge: true` for `devDependencies` (patch/minor), `github-actions` (patch/minor), and `lockFileMaintenance`. A compromised transitive dev/CI dependency could merge without human review (mitigated by `minimumReleaseAge: "3 days"` and `internalChecksFilter: "strict"`). See [known-issues](./known-issues.md#b).

## Invariants when touching this area

- Never log `apiKey` or `githubToken`, directly or via interpolation into a warning/info/debug string.
- Never call `core.setFailed()` and always exit 0 — a permissions/auth failure must `core.warning()` and continue (e.g. `src/index.ts:473-475`). See [observability](./observability.md).
- Never add a secret-bearing field to the API payload in `buildPayload`.
- If you add a new GitHub API call, document the minimum permission it needs and wire the workflow's `permissions` block to least privilege.
