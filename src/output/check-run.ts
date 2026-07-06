import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseFileLocation, normalizePath } from '../utils/parse-stack-trace';
import { formatDuration, renderMetricsStrip } from './format';
import type { ParsedTestRun, ParsedTestCase } from '../types';

const MAX_ANNOTATIONS = 50;

const MAX_CHECK_RUN_ATTEMPTS = 4;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorHeaders(err: unknown): Record<string, string> {
  const response = (err as { response?: { headers?: Record<string, string> } }).response;
  return response?.headers ?? {};
}

// GitHub signals secondary rate limits with a `retry-after` header and/or an "exhausted a
// secondary rate limit" message; primary limits set `x-ratelimit-remaining: 0`. A 403 without any
// of these is a permissions failure, which is NOT worth retrying.
function isRateLimited(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  const headers = errorHeaders(err);
  const message = String((err as { message?: string }).message ?? '').toLowerCase();

  if (headers['retry-after'] != null) return true;
  if (message.includes('rate limit') || message.includes('secondary rate')) return true;
  if ((status === 403 || status === 429) && headers['x-ratelimit-remaining'] === '0') return true;
  return status === 429;
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  const code = (err as { code?: string }).code;

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return true;
  if (isRateLimited(err)) return true;
  return typeof status === 'number' && status >= 500 && status <= 599;
}

function retryDelayMs(err: unknown, attempt: number): number {
  const retryAfter = Number(errorHeaders(err)['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  }
  // Exponential backoff with jitter so concurrent jobs don't retry in lockstep.
  const base = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * INITIAL_RETRY_DELAY_MS;
  return Math.min(base + jitter, MAX_RETRY_DELAY_MS);
}

async function reportCheckRunFailure(checkName: string, err: unknown): Promise<void> {
  const status = (err as { status?: number }).status;
  if (status === 403 && !isRateLimited(err)) {
    core.warning(
      `Unable to create Check Run "${checkName}" — checks: write permission is required. For forked PRs, use the workflow_run event pattern.`,
    );
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  core.error(
    `Failed to create Check Run "${checkName}" after ${MAX_CHECK_RUN_ATTEMPTS} attempts: ${message}. If this check is a required status check the PR will stay blocked until it posts — re-run the job or investigate the GitHub Checks API.`,
  );

  try {
    core.summary.addRaw(
      `\n> ⚠️ **TestGlance could not post the "${checkName}" check run** after ${MAX_CHECK_RUN_ATTEMPTS} attempts (${message}). A required check may be missing on this commit.\n`,
    );
    await core.summary.write();
  } catch {
    // Job-summary write is best-effort — never let it break the action.
  }
}

function resolveLocation(test: ParsedTestCase): { path: string; line: number } | null {
  if (test.file) {
    return { path: normalizePath(test.file), line: test.line ?? 1 };
  }
  if (test.stackTrace) {
    return parseFileLocation(test.stackTrace);
  }
  return null;
}

export interface CheckRunOptions {
  githubToken: string;
  checkName: string;
  parsed: ParsedTestRun;
  reportFile?: string;
  annotationLevel?: 'failure' | 'warning' | 'notice';
}

export async function createCheckRun(options: CheckRunOptions): Promise<void> {
  const { githubToken, checkName, parsed, reportFile, annotationLevel = 'failure' } = options;

  try {
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    const pr = github.context.payload.pull_request as { head?: { sha?: string } } | undefined;
    const headSha = pr?.head?.sha ?? github.context.sha;

    const { summary } = parsed;
    const conclusion = summary.failed > 0 || summary.errored > 0 ? 'failure' : 'success';

    const passRate =
      summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : '0.0';
    const metricsStrip = renderMetricsStrip(summary);
    const title = `Tests: ${metricsStrip} — ${passRate}%`;
    const summaryText = `**${metricsStrip} — ${passRate}%**\n\n⏱️ ${formatDuration(summary.duration)} · 📊 ${summary.total} tests`;

    const annotations: Array<{
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: 'failure' | 'warning' | 'notice';
      message: string;
      title: string;
    }> = [];

    for (const suite of parsed.suites) {
      for (const test of suite.tests) {
        if (test.status !== 'failed' && test.status !== 'errored') continue;
        if (annotations.length >= MAX_ANNOTATIONS) break;

        const location = resolveLocation(test);
        if (!location && !reportFile) continue;

        annotations.push({
          path: location ? location.path : normalizePath(reportFile as string),
          start_line: location ? location.line : 1,
          end_line: location ? location.line : 1,
          annotation_level: annotationLevel,
          message: test.errorMessage ?? 'Test failed',
          title: test.name,
        });
      }
      if (annotations.length >= MAX_ANNOTATIONS) break;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_CHECK_RUN_ATTEMPTS; attempt++) {
      try {
        const response = await octokit.rest.checks.create({
          owner,
          repo,
          name: checkName,
          head_sha: headSha,
          status: 'completed',
          conclusion,
          output: {
            title,
            summary: summaryText,
            annotations,
          },
        });
        core.info(
          `Created check run "${checkName}" (id=${response?.data?.id}, conclusion=${conclusion})`,
        );
        return;
      } catch (err) {
        lastError = err;
        if (isRetryable(err) && attempt < MAX_CHECK_RUN_ATTEMPTS) {
          const message = err instanceof Error ? err.message : String(err);
          core.debug(
            `Check Run "${checkName}" attempt ${attempt}/${MAX_CHECK_RUN_ATTEMPTS} failed: ${message} — retrying`,
          );
          await sleep(retryDelayMs(err, attempt));
          continue;
        }
        break;
      }
    }

    await reportCheckRunFailure(checkName, lastError);
  } catch (err) {
    core.warning(`Failed to create Check Run: ${(err as Error).message}`);
  }
}
