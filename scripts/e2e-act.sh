#!/usr/bin/env bash
#
# Local end-to-end smoke test for the *bundled* Action (dist/index.js + action.yml).
#
# Runs .github/workflows/e2e-local.yml under `act` in Docker, feeding real report
# fixtures through `uses: ./`, then asserts the run exited 0 and that the expected
# marker lines appear in the output. This catches packaging/runtime breakage that
# unit tests can't — *before* pushing. It is a local convenience only: the
# authoritative e2e is .github/workflows/e2e.yml on hosted runners.
#
# Cannot verify: real GitHub Check Run annotations or PR comments (no live GitHub
# API). Those stay covered by the vitest suite (mocked octokit) and hosted e2e.
#
# Constraint: do NOT run two `act` invocations against the same Docker daemon
# concurrently — `act` uses host networking and the containers race.
#
# First run: seed the runner image once with `act --pull` (this script uses
# --pull=false to avoid re-pull churn on every run).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WORKFLOW=".github/workflows/e2e-local.yml"

# ── Gate on Docker: skip (exit 0) rather than hard-fail on machines without it ──
if ! docker info >/dev/null 2>&1; then
  echo "⏭️  SKIP: Docker is not available (daemon not running or not installed)."
  echo "   pnpm e2e:act requires Docker + act. See README → Local development."
  exit 0
fi

if ! command -v act >/dev/null 2>&1; then
  echo "⏭️  SKIP: 'act' is not installed (https://github.com/nektos/act)."
  exit 0
fi

# ── Build dist/index.js — it is the action's runs.main, and dist/ is gitignored ──
echo "▶️  Building dist/ (pnpm build)…"
pnpm build

echo "▶️  Running act against $WORKFLOW …"
OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

# --bind:      bind-mount the working tree instead of `docker cp`-ing it, which
#              fails from deeply nested worktree paths and under concurrent runs.
# --pull=false reuse the cached runner image (seed once with `act --pull`).
set +e
act workflow_dispatch \
  -W "$WORKFLOW" \
  --bind \
  --container-architecture linux/amd64 \
  --pull=false \
  2>&1 | tee "$OUTPUT_FILE"
ACT_EXIT="${PIPESTATUS[0]}"
set -e

echo ""
echo "── Asserting markers ─────────────────────────────────────────"

FAILED=0

fail() {
  echo "❌ $1"
  FAILED=1
}

# 1. act itself must have exited 0.
if [[ "$ACT_EXIT" -ne 0 ]]; then
  fail "act exited non-zero ($ACT_EXIT)"
else
  echo "✅ act exited 0"
fi

# 2. The Action must NEVER call core.setFailed / emit an error (FR5, exit 0).
if grep -qE '::error::|setFailed' "$OUTPUT_FILE"; then
  fail "found an error/setFailed marker — the Action must only warn (FR5)"
else
  echo "✅ no error / setFailed markers"
fi

# 3. Local-only mode path ran (no api-key).
if grep -q 'local-only mode' "$OUTPUT_FILE"; then
  echo "✅ local-only mode marker present"
else
  fail "missing local-only mode marker"
fi

# 4. Both parsers worked across multiple steps. Each successful parse emits one
#    "Parsed N tests from …" line. The workflow has 7 successful-parse steps
#    (local-only, junit auto, ctrf auto, multi-suite, junit+ctrf stacktraces,
#    check-run smoke). A threshold of 6 means breaking EITHER parser (which
#    knocks out that format's steps) drops the count below it and fails here.
PARSED_MIN=6
PARSED_COUNT="$(grep -c 'Parsed [0-9]\+ tests from' "$OUTPUT_FILE" || true)"
if [[ "$PARSED_COUNT" -ge "$PARSED_MIN" ]]; then
  echo "✅ parsed-success count $PARSED_COUNT (>= $PARSED_MIN)"
else
  fail "only $PARSED_COUNT 'Parsed N tests' lines (expected >= $PARSED_MIN) — a parser may be broken"
fi

# 5. Missing-file edge case warns but does not fail.
if grep -q 'No report files found matching' "$OUTPUT_FILE"; then
  echo "✅ missing-file edge case warned"
else
  fail "missing-file edge case did not emit its warning"
fi

# 6. Empty-file edge case warns but does not fail (empty JUnit deterministically throws).
if grep -q 'Failed to parse fixtures/junit-empty.xml' "$OUTPUT_FILE"; then
  echo "✅ empty-file edge case warned"
else
  fail "empty-file edge case did not emit its warning"
fi

# 7. Check Run smoke: with a dummy token the API call cannot succeed, so the
#    Action must warn that it could not create the Check Run — and still exit 0.
if grep -q 'create Check Run' "$OUTPUT_FILE"; then
  echo "✅ Check Run smoke path warned (graceful, exit 0)"
else
  fail "Check Run smoke path did not emit its warning"
fi

echo "──────────────────────────────────────────────────────────────"

if [[ "$FAILED" -ne 0 ]]; then
  echo "❌ e2e:act FAILED — see assertions above."
  exit 1
fi

echo "✅ e2e:act PASSED — bundled Action ran against fixtures and exited 0."
