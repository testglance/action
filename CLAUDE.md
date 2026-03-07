# TestGlance Action

GitHub Action that parses test reports (JUnit XML, CTRF JSON) and sends results to TestGlance.

## Project Overview

- **Repo:** `testglance/action` — standalone, separate from the TestGlance SaaS codebase
- **Runtime:** GitHub Actions `node20`
- **Language:** TypeScript (strict mode)
- **Package manager:** pnpm (not npm or yarn)
- **Test runner:** Vitest
- **Build:** `@vercel/ncc` bundles to `dist/index.js` (committed to repo — required by GitHub Actions)

## Commands

```bash
pnpm test          # run tests
pnpm test:watch    # run tests in watch mode
pnpm build         # compile to dist/index.js
pnpm lint          # eslint
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
dist/                   # Compiled output (COMMITTED — GitHub Actions requirement)
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
5. **`dist/` must be rebuilt and committed** after any source change (`pnpm build`).
6. **Tests use real fixture files** from `fixtures/`. Large fixtures are generated at test time, not committed.

## Parser Contract

Both JUnit and CTRF parsers must output `ParsedTestRun` (defined in `src/types.ts`). This is the normalized structure sent to `POST /api/v1/runs`.

## Architecture — Summary Output

- `src/output/summary.ts` — CI log summary generator using `@actions/core` summary API
- `src/output/__tests__/summary.test.ts` — Unit tests for summary generator
