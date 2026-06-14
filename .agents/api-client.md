# API Client

**Purpose:** How parsed runs are submitted to the TestGlance API, including retry, payload, and error handling.
**Read this when:** You are touching API submission, the request payload, retry/timeout behavior, or error-code handling.

All submission logic lives in `src/api/client.ts`. The wire types (`ApiPayload`, `MetaEnvelope`, `Highlight`) live in `src/types.ts`. The single caller is the submission block in `src/index.ts`.

## Entry point

`sendTestRun(apiUrl, apiKey, parsedRun, metaFields?)` — `src/api/client.ts:70`

```ts
export async function sendTestRun(
  apiUrl: string,
  apiKey: string,
  parsedRun: ParsedTestRun,
  metaFields?: MetaFields,
): Promise<SendResult>;
```

It never throws — every failure path resolves to a `SendResult` with `success: false`. This is the contract that keeps the action non-blocking (FR5; see [known-issues](./known-issues.md)).

`MetaFields` (`src/api/client.ts:34`): optional `framework` and `testJobName`. The caller passes `framework` (from `detectFramework`) and `testJobName` (or `undefined` when blank) — `src/index.ts:367`.

### SendResult shape — `src/api/client.ts:23`

| Field            | Type              | Set when                   |
| ---------------- | ----------------- | -------------------------- |
| `success`        | `boolean`         | always                     |
| `runId`          | `string?`         | success                    |
| `healthScore`    | `number \| null?` | success (may be `null`)    |
| `highlights`     | `Highlight[]?`    | success (defaults to `[]`) |
| `projectId`      | `string?`         | success                    |
| `projectCreated` | `boolean?`        | success                    |
| `errorCode`      | `string?`         | failure                    |
| `errorMessage`   | `string?`         | failure                    |

## Request

- **Method/URL:** `POST ${apiUrl}/api/v1/runs` — `src/api/client.ts:85`
- **Default `apiUrl`:** `https://www.testglance.dev` (from the `api-url` input default in `src/index.ts:150`; `sendTestRun` itself takes whatever string it is given).
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer ${apiKey}` — `src/api/client.ts:87`
- **Body:** `JSON.stringify(payload)` where `payload` is built by `buildPayload`.

## Payload assembly — `buildPayload` (`src/api/client.ts:39`)

Produces `ApiPayload` (`src/types.ts:21`), a two-part envelope: `meta` + `results`. See [data-model](./data-model.md) for the full type graph.

`meta` (`MetaEnvelope`, `src/types.ts:14`) pulls from CI env, defaulting each to `''`:

| Field         | Source                   | Notes                |
| ------------- | ------------------------ | -------------------- |
| `workflow`    | `GITHUB_WORKFLOW`        | always present       |
| `job`         | `GITHUB_JOB`             | always present       |
| `framework`   | `metaFields.framework`   | only added if truthy |
| `testJobName` | `metaFields.testJobName` | only added if truthy |

`results` spreads the `ParsedTestRun` (`summary`, `suites`, `toolName`) and augments it with CI context:

| Field             | Source                         | Fallback              |
| ----------------- | ------------------------------ | --------------------- |
| `repository.name` | `GITHUB_REPOSITORY`            | `''`                  |
| `repository.id`   | `Number(GITHUB_REPOSITORY_ID)` | `0` (also when `NaN`) |
| `git.sha`         | `GITHUB_SHA`                   | `''`                  |
| `git.branch`      | `GITHUB_REF_NAME`              | `''`                  |
| `ciRunId`         | `GITHUB_RUN_ID`                | `''`                  |

`buildPayload` is exported and unit-tested independently of the network call — see [testing](./testing.md).

## Retry, timeout, backoff

Module constants — `src/api/client.ts:3`:

| Constant                     | Value             | Meaning                                  |
| ---------------------------- | ----------------- | ---------------------------------------- |
| `MAX_RETRIES`                | `3`               | total attempts (not retries-after-first) |
| `INITIAL_DELAY_MS`           | `1000`            | base backoff                             |
| `REQUEST_TIMEOUT_MS`         | `10000`           | per-attempt fetch deadline               |
| `NON_RETRYABLE_STATUS_CODES` | `[400, 401, 403]` | bail immediately, no retry               |

The retry loop runs `for attempt = 1..MAX_RETRIES` (`src/api/client.ts:79`):

- Each attempt creates a fresh `AbortController`; a `setTimeout` aborts the `fetch` after `REQUEST_TIMEOUT_MS` (`src/api/client.ts:82-83`). The timer is always cleared in `finally` (`src/api/client.ts:132`).
- **Backoff** between attempts is exponential: `INITIAL_DELAY_MS * 2^(attempt-1)` → 1000ms, then 2000ms (`src/api/client.ts:122` and `:128`). No delay is applied after the final attempt.
- A retryable HTTP error and a thrown error (network failure / timeout abort) both follow the same backoff-and-retry path.

## Response handling

**Success** (`response.ok`, `src/api/client.ts:95`): body is parsed as `ApiSuccessBody` (`.data` envelope, `src/api/client.ts:9`); a JSON parse failure degrades to `{}`. Returns `success: true` with `runId`, `healthScore`, `highlights` (defaulted to `[]`), `projectId`, `projectCreated`.

**HTTP error** (`src/api/client.ts:107`): body is parsed as `ApiErrorBody` (`.error.code` / `.error.message`, `src/api/client.ts:19`); a parse failure synthesizes `{ code: 'UNKNOWN', message: 'HTTP <status>' }`. Then:

- If the status is in `NON_RETRYABLE_STATUS_CODES`, return `{ success: false, errorCode, errorMessage }` immediately (`src/api/client.ts:117`).
- Otherwise record `lastError` and retry (with backoff) until attempts are exhausted.

**Exhausted / thrown** (`src/api/client.ts:136`): after the loop, returns `success: false` with `errorCode: 'NETWORK_ERROR'` and `errorMessage = lastError ?? 'API unreachable after retries'`. Thrown errors inside the loop (timeout abort, DNS, connection reset) set `lastError` to the `Error.message` (`src/api/client.ts:126`).

> `errorCode` is overloaded: `'NETWORK_ERROR'` is a sentinel the client invents, distinct from any server-sent `error.code`. The caller branches on it (below).

## Error categories surfaced to `index.ts`

The submission block (`src/index.ts:366`) only runs when `sendResults` is true. It maps `SendResult` to non-blocking outcomes (all via `core.*`, never `setFailed`):

| Outcome       | Branch                                 | Handler                                                                     |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Success       | `result.success`                       | `core.info` with `runId`, and health score if non-null (`src/index.ts:372`) |
| Network error | `result.errorCode === 'NETWORK_ERROR'` | `handleApiUnreachable()` → `core.warning` (`src/utils/errors.ts:18`)        |
| API error     | else                                   | `handleApiError(code, message)` → `core.warning` (`src/utils/errors.ts:24`) |

A successful `runId` also drives `dashboardUrl = https://www.testglance.dev/runs/${runId}` (`src/index.ts:384`), consumed by [output](./output.md) (summary, PR comment, HTML report).

## Local-only mode (no submission)

`sendResults` gates whether `sendTestRun` is ever called (`src/index.ts:154`):

```ts
const localOnly = !apiKey;
const sendResults = localOnly ? false : core.getInput('send-results') !== 'false';
```

So submission is skipped when **either** `api-key` is absent (`localOnly`) **or** `send-results` is `'false'`. In local-only mode the summary, PR comment, and check run still run — only API submission is suppressed. See [inputs-reference](./inputs-reference.md) for `api-key` / `send-results` semantics.
