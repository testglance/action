# OSS Adoption FAQ

Answers to common questions maintainers ask when reviewing a PR that adds `testglance/action`.

---

## 1. "Why are you adding a dependency?"

The action is CI-only — it runs after your tests and has zero effect on builds, runtime, or library dependencies. It is pinned by tag (e.g. `testglance/action@v1`) or by SHA for reproducibility. If the added surface area isn't worth it to you, say the word and the PR will be closed immediately.

---

## 2. "What data do you collect?"

In local-only mode (no `api-key` input): **nothing leaves GitHub**. The action reads test reports from the workspace, writes PR comments, Check Run annotations, and caches history — all through the GitHub API gated by the permissions you grant.

The outbound HTTP call to TestGlance only exists inside a conditional:

- [`src/index.ts:L332`](https://github.com/testglance/action/blob/main/src/index.ts#L332) — `sendResults` gate
- [`src/api/client.ts:L85`](https://github.com/testglance/action/blob/main/src/api/client.ts#L85) — the only outbound fetch, targeting `{apiUrl}/api/v1/runs`

An invariant test verifies the action never calls `core.setFailed`: [`src/__tests__/index.test.ts:L345`](https://github.com/testglance/action/blob/main/src/__tests__/index.test.ts#L345).

### What gets sent where

| Mode                          | Destinations                                     | Gated by                          |
| ----------------------------- | ------------------------------------------------ | --------------------------------- |
| **Local-only** (no `api-key`) | GitHub API only — PR comments, Check Runs, cache | `permissions` block in workflow   |
| **SaaS mode**                 | Adds `www.testglance.dev/api/v1/runs`            | `api-key` + `send-results` inputs |

Without `api-key`, the TestGlance origin is never contacted. There is no telemetry, analytics, or version-check traffic.

---

## 3. "Can you open an issue first per CONTRIBUTING.md?"

Apologies for skipping that step. Happy to close this PR and open an issue instead so the team can discuss it on your terms first.

---

## 4. "We already use dorny/test-reporter / EnricoMi / mikepenz."

Understood — those tools already solve the problem for your repo. Closing this PR. Thanks for taking the time to review it.

---

## 5. "Why is there a SaaS in the README?"

The SaaS dashboard is an optional add-on. The PR as submitted runs in local-only mode — no API key, no external calls. The action defaults to local-only when `api-key` is not provided ([`src/index.ts:L119`](https://github.com/testglance/action/blob/main/src/index.ts#L119)).

---

## 6. "The action is new / has few stars / no track record."

Fair concern. You can pin to a specific commit SHA instead of a tag to guarantee the code never changes under you. The action includes an invariant test ensuring it never fails your build ([`src/__tests__/index.test.ts:L345`](https://github.com/testglance/action/blob/main/src/__tests__/index.test.ts#L345)). If that's still not enough confidence, completely understand closing the PR.

---

## 7. "Can you show me this working on our repo first?"

Absolutely. Fork the repo, add the workflow step, push, and link the resulting run in the PR so reviewers can see actual output on real test data before merging.
