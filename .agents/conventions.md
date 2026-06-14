# Conventions

**Purpose:** Naming, file layout, code style, and the non-negotiable critical rules — expanded with the _why_.
**Read this when:** Before writing any new code in this repo.

This is a TypeScript GitHub Action (runtime `node24`, see `action.yml:90`). pnpm only — never npm/yarn. Test runner is Vitest. See `[architecture](./architecture.md)` for the full module map and `[build-and-release](./build-and-release.md)` for the dist/release flow.

## Naming

| Thing              | Convention                                           | Examples                                                             |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Files              | `kebab-case.ts`                                      | `detect-format.ts`, `actions-cache-storage.ts`, `perf-regression.ts` |
| Functions          | `camelCase`, verb-first                              | `parseJunitXml`, `detectFormat`, `handleApiUnreachable`              |
| Types / interfaces | `PascalCase`                                         | `ParsedTestRun`, `ParsedSuite`, `ParsedTestCase`                     |
| Constants          | `UPPER_SNAKE_CASE`                                   | top-level config constants                                           |
| Tests              | `{module}.test.ts` inside a sibling `__tests__/` dir | `parsers/__tests__/junit.test.ts`                                    |

Error handlers follow a `handle{Condition}` verb-first pattern — see `src/utils/errors.ts:10` (`handleFileNotFound`), `:18` (`handleApiUnreachable`), `:28` (`handleUnexpectedError`).

## Self-documenting code

- **No WHAT comments.** Never `// increment counter`. The code already says what.
- **WHY-only comments**, and only when a decision is non-obvious (a workaround, a spec quirk, a deliberate deviation from the obvious approach).
- Prefer descriptive names and small functions over comments.

## TypeScript

From `tsconfig.json`:

- `strict: true` — no implicit `any`, strict null checks, etc.
- `target` / `module` / `lib`: **ES2022** (`tsconfig.json:3-5`).
- `moduleResolution: "bundler"` (`tsconfig.json:14`) — `@vercel/ncc` bundles everything into `dist/index.js`, so resolution is bundler-style, not node.
- `rootDir: ./src`, `outDir: ./dist`. `resolveJsonModule: true` (fixtures/JSON parsing). `esModuleInterop`, `forceConsistentCasingInFileNames`, `sourceMap` all on.
- `exclude` drops `node_modules`, `dist`, `fixtures`, and `**/__tests__/**` from the typecheck set (`tsconfig.json:17`). `pnpm typecheck` runs `tsc --noEmit`.

## Lint + format

ESLint **flat config** (`eslint.config.mjs`):

- `typescript-eslint` recommended + `eslint-config-prettier` (disables formatting rules so Prettier owns formatting).
- Ignores `dist/`, `node_modules/`, `fixtures/` (`eslint.config.mjs:6`).
- One custom rule (`eslint.config.mjs:11`):
  ```
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  ```
  Unused vars are errors, **except** names prefixed with `_` (use `_unused`, `_err` to intentionally ignore).

Prettier (`.prettierrc`) — these are non-negotiable, ESLint won't fight them:

| Option          | Value  |
| --------------- | ------ |
| `singleQuote`   | `true` |
| `trailingComma` | `all`  |
| `printWidth`    | `100`  |
| `tabWidth`      | `2`    |
| `semi`          | `true` |

Run `pnpm lint` / `pnpm lint:fix` and `pnpm format` / `pnpm format:check`.

## Critical rules (and why)

These are load-bearing product requirements, not style preferences. Breaking them breaks consumers' CI or the release pipeline.

1. **Never call `core.setFailed()`. Always exit 0.**
   The Action is non-blocking by design (product req FR5) — a malformed test report or an API outage must never turn a consumer's green build red. Every error path routes through `core.warning()` (or `core.debug()` for some analytics-only failures — see `[known-issues](./known-issues.md)`). All five error handlers in `src/utils/errors.ts` call `core.warning` and return `void`; none throw, none fail. This is enforced by tests (e.g. `src/__tests__/index.test.ts:350`, `src/utils/__tests__/errors.test.ts:66`). There is no `process.exit` anywhere — the process exits 0 naturally.

2. **Recount test results from `<testcase>` / `test` elements — never trust suite-level count attributes.**
   `<testsuite tests="…" failures="…">` attributes are routinely wrong (frameworks miscount, merge incorrectly, or omit skips). The summary is recomputed from the actual leaf elements: see `src/parsers/junit.ts:148-155`, where `total`/`passed`/`failed`/`skipped`/`errored` are derived from `allTests.filter(...)` over the flattened test cases — the suite attributes are not read for counts.

3. **Use `fast-xml-parser` for XML — only.**
   Not xml2js, not cheerio. The parser config (`isArray` for `testsuite`/`testcase`/`property`) lives at `src/parsers/junit.ts:11`. Consistency keeps the XML→`ParsedTestRun` mapping in one well-understood library; `fast-xml-parser` is the sole XML dep in `package.json`.

4. **Never commit `dist/`.**
   `dist/` is gitignored. CI's `release-v1` job rebuilds it and commits it back to `main` as `chore: rebuild dist [skip ci]`, then force-retags `v1`. Committing `dist/` from a feature branch corrupts that flow and produces merge noise. Run `pnpm build` locally only to verify the bundle compiles. See `[build-and-release](./build-and-release.md)`.

5. **Tests use real fixture files, not hand-built strings.**
   Small fixtures are committed under `fixtures/` and `src/output/__tests__/fixtures/`; large fixtures are generated at test time (not committed) to keep the repo lean. Parsers and output modules are exercised against real reports, not synthetic snippets. See `[testing](./testing.md)`.

## Commits

Conventional Commits, enforced by **commitlint** (`.commitlintrc.json` extends `@commitlint/config-conventional`) via a Husky hook (`prepare: "husky"`). The header parser tolerates a leading emoji/non-letter prefix before the type (`headerPattern` in `.commitlintrc.json`). Use `type(scope): subject`, e.g. `fix(summary): suppress banner in local-only mode`. See `[build-and-release](./build-and-release.md)` for the release tagging that rides on these.

## Where things live

One-line map of `src/` (full detail in `[architecture](./architecture.md)`):

| Dir / file     | Responsibility                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts` | Entry point: read inputs, discover/detect/parse reports, fan out to outputs + API                                       |
| `src/types.ts` | `ParsedTestRun` / `ParsedSuite` / `ParsedTestCase` — the normalized contract (`[data-model](./data-model.md)`)          |
| `src/parsers/` | `junit.ts`, `ctrf.ts` → both emit `ParsedTestRun` (`[parsers](./parsers.md)`)                                           |
| `src/output/`  | summary, PR comment, check-run annotations, HTML report, artifact upload, templates (`[output](./output.md)`)           |
| `src/history/` | run history via Actions Cache, flaky detection, perf regression, trends (`[history-analytics](./history-analytics.md)`) |
| `src/api/`     | `client.ts` — HTTP client with retry, `POST /api/v1/runs` (`[api-client](./api-client.md)`)                             |
| `src/utils/`   | `errors.ts`, `detect-format.ts`, `discover-files.ts`, `merge-results.ts`, `parse-stack-trace.ts`, framework detection   |

Every leaf dir has a sibling `__tests__/` directory holding `{module}.test.ts`.
