# Install Prompt

A portable prompt you can paste into any project's Claude Code (or similar AI coding agent) session to install the TestGlance GitHub Action.

TestGlance is zero-config: it auto-detects JUnit XML / CTRF JSON reports, posts a CI summary, and never fails the build. This prompt tells the agent to wire it into an existing (or new) test workflow with the right permissions, without introducing a new test framework or committing anything.

## The prompt

Copy everything below into your agent.

---

Install the TestGlance GitHub Action (`testglance/action@v1`) in this repository. It's zero-config: it auto-detects JUnit XML / CTRF JSON reports and posts a CI summary, never fails the build, and needs no signup.

**Steps:**

1. **Find the test workflow.** Look in `.github/workflows/` for a workflow that runs tests. If none exists, create `.github/workflows/test.yml` with a minimal job that checks out, installs deps, and runs the project's tests (detect the stack from `package.json` / `pyproject.toml` / `go.mod` / `pom.xml` / `Cargo.toml` / etc.).

2. **Confirm tests emit a report.** TestGlance auto-detects `**/test-results/*.xml`, `**/junit.xml`, `**/ctrf/*.json`, etc. If the current test command does NOT produce one of these, configure the runner to do so (Vitest/Jest → `jest-junit` or `--reporter=junit`, pytest → `--junitxml=test-results/junit.xml`, Go → `gotestsum --junitfile=...`, etc.). Prefer JUnit XML. Minimal change — no new test framework.

3. **Add the TestGlance step.** After the test step, add:

   ```yaml
   - uses: testglance/action@v1
     if: always()
     with:
       github-token: ${{ github.token }}
   ```

   `if: always()` so it runs when tests fail. Omit `report-path` — let auto-detect do its job unless the report lands somewhere non-standard.

4. **Permissions.** Add to the job (or workflow):

   ```yaml
   permissions:
     contents: read
     pull-requests: write
     checks: write
   ```

   Adding a `permissions` block drops all defaults, so list every permission the job needs. If you also want inline failure annotations on the PR diff, add `annotate-failures: true` to the action's `with:` block.

5. **Don't add an API key.** The action works fully without one — CI summaries, PR comments, annotations all work standalone. Only mention `api-key: ${{ secrets.TESTGLANCE_API_KEY }}` if the user explicitly asks for the SaaS dashboard.

6. **Verify.** Run the test command locally once to confirm the report file actually lands where auto-detect will find it. If it doesn't, either move the output or set `report-path:` explicitly.

7. **Report back — do NOT commit.** Show me: (a) the workflow diff, (b) any test-runner config change, (c) the report path the action will pick up, (d) a one-line confirmation that `if: always()` and the permissions block are in place.

**Hard rules:**

- Reference as `testglance/action@v1` (floating major tag). No SHA, no `@main`.
- Don't wrap in `continue-on-error` — the action is non-blocking by design (always exits 0).
- Don't break or rewrite existing workflows; extend them.
- Don't introduce a new test framework; only adjust reporter output.
