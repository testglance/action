import * as github from '@actions/github';

export interface RunIdentity {
  /** Commit the results belong to; `null` when the event doesn't identify it. */
  checkRunSha: string | null;
  /** Cache namespace for run history; `null` when the event doesn't identify the branch. */
  historyBranch: string | null;
  /** Commit shown in summaries and stored with history entries. */
  commitSha: string;
  /** Branch shown in summaries. */
  displayBranch: string;
}

interface RepoRef {
  full_name?: string;
}

interface WorkflowRunPayload {
  head_sha?: string;
  head_branch?: string | null;
  head_repository?: RepoRef;
}

interface PullRequestPayload {
  head?: { sha?: string; ref?: string; repo?: RepoRef | null };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// workflow_run and pull_request_target jobs run in the base repository's cache scope, so a
// fork's branch named e.g. `main` would otherwise write into the real `main` history. `~` is
// not allowed in git ref names, so a qualified name can never collide with a real branch.
// When `requireRepos` is set and fork-ness can't be determined, return null (skip history)
// rather than risk writing a fork's branch into the base repository's namespace.
function qualifyForkBranch(
  branch: string | null,
  headRepo: RepoRef | null | undefined,
  requireRepos: boolean,
): string | null {
  if (!branch) return null;
  const baseRepo = nonEmpty((github.context.payload.repository as RepoRef | undefined)?.full_name);
  const head = nonEmpty(headRepo?.full_name);
  if (!head || !baseRepo) return requireRepos ? null : branch;
  return head === baseRepo ? branch : `${head}~${branch}`;
}

export function resolveRunIdentity(): RunIdentity {
  const { eventName, payload } = github.context;
  const envBranch = (process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '').replace(
    /^refs\/heads\//,
    '',
  );
  const envSha = process.env.GITHUB_SHA || '';

  // GITHUB_SHA / GITHUB_REF_NAME point at the default branch for these events, not at the
  // commit whose results are being reported.
  if (eventName === 'workflow_run') {
    const run = (payload.workflow_run ?? {}) as WorkflowRunPayload;
    const headSha = nonEmpty(run.head_sha);
    const headBranch = nonEmpty(run.head_branch);
    return {
      checkRunSha: headSha,
      historyBranch: qualifyForkBranch(headBranch, run.head_repository, true),
      commitSha: headSha ?? 'unknown',
      displayBranch: headBranch ?? 'unknown',
    };
  }

  const pr = payload.pull_request as PullRequestPayload | undefined;

  // On a PR the comment doesn't say which commit was tested; on a plain issue the run is
  // on the default branch, exactly like a push.
  if (eventName === 'issue_comment' && !pr && payload.issue?.pull_request) {
    return {
      checkRunSha: null,
      historyBranch: null,
      commitSha: envSha || 'unknown',
      displayBranch: envBranch || 'unknown',
    };
  }

  // pull_request_target runs in the base repository's cache scope with GITHUB_SHA at the base
  // branch HEAD; pull_request runs in the PR's own merge-ref scope, so an unknown head repo
  // there can't reach the base branch's history.
  const isPrTarget = eventName === 'pull_request_target';
  const prHeadSha = nonEmpty(pr?.head?.sha);
  return {
    checkRunSha: prHeadSha ?? nonEmpty(github.context.sha),
    historyBranch: pr
      ? qualifyForkBranch(envBranch || 'unknown', pr.head?.repo, isPrTarget)
      : envBranch || 'unknown',
    commitSha: (isPrTarget ? prHeadSha : null) ?? (envSha || 'unknown'),
    displayBranch: envBranch || 'unknown',
  };
}
