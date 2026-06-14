# `.agents/` — Agent Knowledge Base

**Purpose:** Index and routing map for the focused reference docs that describe this codebase (design, subsystems, testing, observability, ops).
**Read this when:** You're not sure which doc covers your task, or you want the full map.

## How these docs work

- `CLAUDE.md` (and the mirrored root `AGENTS.md`) hold only the high-frequency essentials —
  identity, commands, critical rules, conventions, and a routing table into this directory.
- These `.agents/*.md` files are **loaded on demand**, not auto-loaded. Open the one your
  task points to so session context stays small and high-signal.
- Docs describe **reality** as found in source, with clickable `path:line` references. When
  something is a known wart, the doc links to [known-issues](./known-issues.md) rather than
  pretending it's ideal.

## Routing map

### Orientation

| Doc                               | Covers                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture](./architecture.md) | End-to-end `run()` pipeline, `src/` module map, cross-cutting patterns (non-blocking errors, dual-mode, history stage, adaptive output sizing) |
| [glossary](./glossary.md)         | Domain & code term definitions, each mapped to its source location and explaining doc                                                          |

### Core contracts & subsystems

| Doc                                         | Covers                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [data-model](./data-model.md)               | `ParsedTestRun`/`Suite`/`TestCase`, history types, and the `POST /api/v1/runs` payload envelope shared across the codebase             |
| [parsers](./parsers.md)                     | JUnit/CTRF parsing into the normalized run, plus format/framework detection, file discovery, result merging, stack-trace extraction    |
| [history-analytics](./history-analytics.md) | Actions-Cache run history (`HistoryManager`) and the analytics on it — delta, flaky, perf regression, trends, cross-branch base delta  |
| [output](./output.md)                       | The four output surfaces (job summary, PR comment, check-run annotations, HTML report) plus shared formatters and Handlebars templates |
| [api-client](./api-client.md)               | `sendTestRun`, `buildPayload`, retry/timeout/backoff, `SendResult`, error-category mapping, local-only gating                          |

### Working in the repo

| Doc                                       | Covers                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [conventions](./conventions.md)           | Naming, file layout, code style (TS/ESLint/Prettier), commit conventions, and the critical rules with rationale          |
| [agent-playbook](./agent-playbook.md)     | Step-by-step recipes (new parser, input, output channel, API field, history metric) with exact wiring points and gotchas |
| [inputs-reference](./inputs-reference.md) | Every `action.yml` input — defaults, accepted values, and the `parse*` validation helpers in `run()`                     |

### Quality & operations

| Doc                                         | Covers                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [testing](./testing.md)                     | Vitest config, fixtures, the mocked orchestration suite, and the e2e / `act` smoke layers                                         |
| [build-and-release](./build-and-release.md) | ncc bundling, why `dist/` is gitignored, CI jobs, the dist-rebuild + floating `v1` release flow, husky, commitlint, the ESM patch |
| [observability](./observability.md)         | The never-break-CI philosophy: `core.warning` for all errors, log-level map, graceful degradation                                 |
| [security](./security.md)                   | Secret handling (api-key, github-token, App creds), least-privilege permissions, `dist/` supply-chain trust model                 |

### Meta

| Doc                               | Covers                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [known-issues](./known-issues.md) | Known best-practice gaps & tech debt, each with a tracking GitHub issue — check before "fixing" a documented wart |
