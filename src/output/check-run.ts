import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseFileLocation } from '../utils/parse-stack-trace';
import type { ParsedTestRun } from '../types';

const MAX_ANNOTATIONS = 50;

export interface CheckRunOptions {
  githubToken: string;
  checkName: string;
  parsed: ParsedTestRun;
}

export async function createCheckRun(options: CheckRunOptions): Promise<void> {
  const { githubToken, checkName, parsed } = options;

  try {
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    const pr = github.context.payload.pull_request as
      | { head?: { sha?: string } }
      | undefined;
    const headSha = pr?.head?.sha ?? github.context.sha;

    const { summary } = parsed;
    const conclusion = summary.failed > 0 ? 'failure' : 'success';

    const titleParts: string[] = [];
    if (summary.passed > 0) titleParts.push(`${summary.passed} passed`);
    if (summary.failed > 0) titleParts.push(`${summary.failed} failed`);
    if (summary.skipped > 0) titleParts.push(`${summary.skipped} skipped`);
    const title = `Tests: ${titleParts.join(', ')}`;

    const passRate =
      summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : '0.0';
    const summaryText = `**Pass rate:** ${passRate}%\n**Duration:** ${summary.duration.toFixed(1)}s\n**Total:** ${summary.total} tests`;

    const annotations: Array<{
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: 'failure';
      message: string;
      title: string;
    }> = [];

    for (const suite of parsed.suites) {
      for (const test of suite.tests) {
        if (test.status !== 'failed') continue;
        if (annotations.length >= MAX_ANNOTATIONS) break;

        const location = test.stackTrace ? parseFileLocation(test.stackTrace) : null;
        if (!location) continue;

        annotations.push({
          path: location.path,
          start_line: location.line,
          end_line: location.line,
          annotation_level: 'failure',
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
