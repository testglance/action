import * as core from '@actions/core';
import * as github from '@actions/github';
import type { PrCommentSection } from './pr-comment';
import { renderPrComment, mergeTestJobSection } from './pr-comment';

export interface PostPrCommentOptions {
  githubToken: string;
  section: PrCommentSection;
}

const COMMENT_MARKER = '<!-- testglance-pr-summary -->';
const ACTIONS_BOT_LOGIN = 'github-actions[bot]';

type Octokit = ReturnType<typeof github.getOctokit>;

interface IssueComment {
  id: number;
  body?: string | null;
  user?: { login?: string; type?: string } | null;
}

// Any PR participant can post a comment containing the marker; only a comment written by
// this token's identity may be adopted, or a stranger could hijack/suppress the summary and
// feed forged job state into the merge.
async function resolveTokenLogin(octokit: Octokit): Promise<string | null> {
  try {
    const result = await octokit.graphql<{ viewer?: { login?: string } }>(
      'query { viewer { login } }',
    );
    return result?.viewer?.login || null;
  } catch (err) {
    core.debug(
      `Could not resolve the github-token identity (${(err as Error).message}); assuming ${ACTIONS_BOT_LOGIN}.`,
    );
    return null;
  }
}

function isOwnComment(comment: IssueComment, tokenLogin: string | null): boolean {
  const login = comment.user?.login;
  if (!login) return false;
  if (tokenLogin) return login.toLowerCase() === tokenLogin.toLowerCase();
  return comment.user?.type === 'Bot' && login === ACTIONS_BOT_LOGIN;
}

export async function postPrComment(options: PostPrCommentOptions): Promise<void> {
  const { githubToken, section } = options;

  if (!githubToken) return;

  const prNumber =
    (github.context.payload.pull_request?.number as number | undefined) ??
    github.context.issue?.number;
  if (!prNumber) return;

  try {
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    const [comments, tokenLogin] = await Promise.all([
      octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      }) as Promise<IssueComment[]>,
      resolveTokenLogin(octokit),
    ]);

    const existing = comments.find(
      (c) => c.body?.includes(COMMENT_MARKER) && isOwnComment(c, tokenLogin),
    );

    if (existing) {
      const updatedBody = mergeTestJobSection(existing.body!, section);
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: updatedBody,
      });
    } else {
      const body = renderPrComment([section]);
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
    }
  } catch (err) {
    core.warning(`Failed to post PR comment: ${(err as Error).message}`);
  }
}
