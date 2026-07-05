# TestGlance Action

GitHub Action that parses test reports (JUnit XML, CTRF JSON) and sends results to TestGlance.

## Project Overview

- **Repo:** `testglance/action` — standalone, separate from the TestGlance SaaS codebase
- **Runtime:** GitHub Actions `node20`
- **Language:** TypeScript (strict mode)
- **Package manager:** pnpm (not npm or yarn)
- **Test runner:** Vitest
- **Build:** `@vercel/ncc` bundles to `dist/index.js`. `dist/` is **gitignored** and built by CI on every push to `main` (and by the `test` job on PRs so the self-test can run `uses: ./`). Never commit `dist/` from a feature branch.

## Commands

```bash
pnpm test          # run tests
pnpm test:watch    # run tests in watch mode
pnpm build         # compile to dist/index.js
pnpm lint          # eslint
pnpm lint:fix      # eslint --fix
pnpm format        # prettier --write
pnpm format:check  # prettier --check
pnpm typecheck     # tsc --noEmit
```

## Architecture

```
src/
  index.ts              # Action entry point — reads inputs, detects format, parses, sends to API
  types.ts              # ParsedTestRun / ParsedSuite / ParsedTestCase (shared contract)
  parsers/
    junit.ts            # JUnit XML parser (fast-xml-parser)
    ctrf.ts             # CTRF JSON parser (native JSON.parse)
    __tests__/
      junit.test.ts     # JUnit parser tests using fixtures/
      ctrf.test.ts      # CTRF parser tests using fixtures/
  api/
    client.ts           # HTTP API client with retry logic (POST /api/v1/runs)
    __tests__/
      client.test.ts    # API client unit tests
  utils/
    errors.ts           # ParseError class + non-blocking error handlers (core.warning only)
    detect-format.ts    # Report format auto-detection from file extension
    __tests__/
      detect-format.test.ts
      errors.test.ts
  __tests__/
    index.test.ts       # Integration tests for full run() pipeline
fixtures/               # Test fixtures (XML + JSON). Large fixtures generated at test time.
dist/                   # Compiled output (gitignored; built and committed to main by CI, never per-PR)
action.yml              # Action metadata (inputs, runtime)
```

## Conventions

- **Files:** `kebab-case.ts`
- **Functions:** `camelCase`, verb-first (`parseJunitXml`, `detectFormat`)
- **Types/Interfaces:** `PascalCase` (`ParsedTestRun`, `ParsedTestCase`)
- **Constants:** `UPPER_SNAKE_CASE`
- **Tests:** `{module}.test.ts` in `__tests__/` directories
- **No WHY-less comments.** Code should be self-documenting. Only add comments explaining non-obvious WHY, never WHAT.

## Critical Rules

1. **Never call `core.setFailed()`** — this Action must never break CI. Use `core.warning()` for all errors.
2. **Always exit 0** — non-blocking by design (product requirement FR5).
3. **Use `fast-xml-parser`** for XML — not xml2js, not cheerio.
4. **Recount test results from `<testcase>` elements** — never trust suite-level count attributes.
5. **Never commit `dist/`.** It's gitignored and produced by CI. Run `pnpm build` locally only to verify the bundle compiles.
6. **Tests use real fixture files** from `fixtures/`. Large fixtures are generated at test time, not committed.

## Release

- Push source-only commits to `main` (via PR). The `release-v1` job in `.github/workflows/ci.yml` rebuilds `dist/`, commits it back to `main` as `chore: rebuild dist [skip ci]`, then force-retags `v1` to that commit.
- Action consumers reference `testglance/action@v1` — a floating major-version tag that always points at the latest dist-bearing commit on `main`.

## Parser Contract

Both JUnit and CTRF parsers must output `ParsedTestRun` (defined in `src/types.ts`). This is the normalized structure sent to `POST /api/v1/runs`.

## Architecture — Summary Output

- `src/output/summary.ts` — CI log summary generator using `@actions/core` summary API
- `src/output/__tests__/summary.test.ts` — Unit tests for summary generator
