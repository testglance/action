import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseFileLocation, normalizePath } from '../utils/parse-stack-trace';
import { formatDuration, renderMetricsStrip } from './format';
import type { ParsedTestRun, ParsedTestCase } from '../types';

const MAX_ANNOTATIONS = 50;

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

    await octokit.rest.checks.create({
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
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403) {
      core.warning(
        'Unable to create Check Run — checks: write permission is required. For forked PRs, use the workflow_run event pattern.',
      );
    } else {
      core.warning(`Failed to create Check Run: ${(err as Error).message}`);
    }
  }
}
