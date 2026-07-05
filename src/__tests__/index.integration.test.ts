// Real integration suite — deliberately NO vi.mock. Unlike index.test.ts (which
// stubs every collaborator to verify run()'s orchestration), this drives the actual
// pipeline end-to-end: discoverReportFiles → readFileSync → detectFormat →
// parseJunitXml/parseCtrfJson → mergeTestRuns → detectFramework → generateSummary
// (real @actions/core writing the CI job summary to a temp file). It proves the real
// modules integrate against committed fixtures.
//
// Kept hermetic and offline via inputs only: no api-key (local-only → no API call),
// history disabled (no @actions/cache), and no github-token (no check-run / PR comment).
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('run() real integration (unmocked pipeline)', () => {
  let tmpDir: string;
  let summaryFile: string;

  // @actions/core.summary is a module singleton that caches its resolved file path,
  // so the whole suite writes to one stable file that we truncate before each test
  // rather than a fresh per-test path.
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tg-integration-'));
    summaryFile = join(tmpDir, 'summary.md');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.resetModules();
    // core.summary.write() access-checks the file, so it must exist; empty it so each
    // test only sees its own output.
    writeFileSync(summaryFile, '');

    vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);
    vi.stubEnv('INPUT_API-KEY', ''); // local-only mode → no API submission
    vi.stubEnv('INPUT_HISTORY', 'false'); // skip @actions/cache round-trip
    // github-token intentionally unset → no check-run / PR-comment network calls
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses a real JUnit fixture and writes the recounted totals to the CI summary', async () => {
    vi.stubEnv('INPUT_REPORT-PATH', 'fixtures/junit-basic.xml');

    const { run } = await import('../index');
    const result = await run();

    expect(result).toEqual({ history: null });

    const summary = readFileSync(summaryFile, 'utf-8');
    // Recounted from the six <testcase> elements, NOT the suite-level tests="6" attribute.
    expect(summary).toContain('✅ 3 passed');
    expect(summary).toContain('❌ 1 failed');
    expect(summary).toContain('💥 1 errored');
    expect(summary).toContain('⏭️ 1 skipped');
    expect(summary).toContain('50.0%');
    expect(summary).toContain('should reject invalid password');
  });

  it('parses a real CTRF fixture through the same pipeline', async () => {
    vi.stubEnv('INPUT_REPORT-PATH', 'fixtures/ctrf-basic.json');

    const { run } = await import('../index');
    const result = await run();

    expect(result).toEqual({ history: null });

    const summary = readFileSync(summaryFile, 'utf-8');
    expect(summary).toContain('✅ 5 passed');
    expect(summary).toContain('❌ 2 failed');
    expect(summary).toContain('⏭️ 1 skipped');
  });
});
