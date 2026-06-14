# AGENTS.md — TestGlance Action

> Cross-tool agent guide (Cursor, Codex, Copilot, etc.). This is a **mirror of
> [`CLAUDE.md`](CLAUDE.md)** — when you change one, change the other. Deep reference docs
> live in [`.agents/`](.agents/README.md) and are loaded on demand.

GitHub Action that parses test reports (JUnit XML, CTRF JSON), derives history/analytics, and renders results to the CI summary, PR comments, check-run annotations, and an HTML report — optionally sending them to the TestGlance API.

## Overview

- **Repo:** `testglance/action` — standalone, separate from the TestGlance SaaS codebase.
- **Runtime:** GitHub Actions `node24` (`action.yml` → `using: 'node24'`).
- **Language:** TypeScript (strict). **Package manager:** pnpm. **Tests:** Vitest.
- **Two modes:** _API mode_ (api-key set → `POST /api/v1/runs`) and _local-only mode_
  (no api-key → summary / PR comment / check run still work, nothing is sent).
- **Build:** `@vercel/ncc` bundles to `dist/index.js`. `dist/` is **gitignored**; CI builds
  it and commits it to `main` (the `release-v1` job). Never commit `dist/` from a branch.

## Commands

```bash
pnpm test          # run tests (vitest run)
pnpm test:watch    # tests in watch mode
pnpm build         # bundle to dist/index.js (ncc) — local verify only
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint            (lint:fix to autofix)
pnpm format:check  # prettier --check  (format to write)
pnpm e2e:act       # local e2e smoke via act (skips gracefully without docker/act)
```

## Critical rules (non-negotiable)

1. **Never call `core.setFailed()`; always exit 0.** This Action must never break a
   consumer's CI (product req FR5). Route every error through `core.warning()`.
2. **Recount results from `<testcase>`/test elements** — never trust suite-level count attributes.
3. **Use `fast-xml-parser`** for XML — not xml2js, not cheerio.
4. **Never commit `dist/`.** It's gitignored and produced by CI; `pnpm build` locally only to verify the bundle compiles.
5. **Tests use real fixtures** from `fixtures/` — small ones committed, large ones generated at test time.

See [`.agents/conventions.md`](.agents/conventions.md) for rationale, and
[`.agents/known-issues.md`](.agents/known-issues.md) before "fixing" anything that looks off.

## Conventions (cheat-sheet)

- **Files:** `kebab-case.ts` · **Functions:** `camelCase`, verb-first · **Types:** `PascalCase` · **Constants:** `UPPER_SNAKE_CASE`
- **Tests:** `{module}.test.ts` in `__tests__/` dirs.
- **Self-documenting code:** no WHAT comments; WHY-comments only for non-obvious decisions.

## Where to read more — routing table

| Working on…                                            | Read                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Big picture / where things live                        | [`.agents/architecture.md`](.agents/architecture.md)           |
| Types & the `ParsedTestRun` / API payload contract     | [`.agents/data-model.md`](.agents/data-model.md)               |
| Parsing, format/framework detection, discovery, merge  | [`.agents/parsers.md`](.agents/parsers.md)                     |
| History & the flaky / perf / trends / delta analytics  | [`.agents/history-analytics.md`](.agents/history-analytics.md) |
| Summary, PR comment, check run, HTML report, templates | [`.agents/output.md`](.agents/output.md)                       |
| API submission, retries, payload, error mapping        | [`.agents/api-client.md`](.agents/api-client.md)               |
| Action inputs (defaults, accepted values)              | [`.agents/inputs-reference.md`](.agents/inputs-reference.md)   |
| Writing/running tests, fixtures, e2e                   | [`.agents/testing.md`](.agents/testing.md)                     |
| Build, `dist/`, CI, the floating `v1` release          | [`.agents/build-and-release.md`](.agents/build-and-release.md) |
| Logging, error handling, the never-fail rule           | [`.agents/observability.md`](.agents/observability.md)         |
| Secrets, tokens, permissions, supply chain             | [`.agents/security.md`](.agents/security.md)                   |
| Naming, style, critical rules (full)                   | [`.agents/conventions.md`](.agents/conventions.md)             |
| **Implementing a change — start here for recipes**     | [`.agents/agent-playbook.md`](.agents/agent-playbook.md)       |
| A term you don't recognize                             | [`.agents/glossary.md`](.agents/glossary.md)                   |
| Something looks wrong / known tech debt                | [`.agents/known-issues.md`](.agents/known-issues.md)           |
| Full index                                             | [`.agents/README.md`](.agents/README.md)                       |
