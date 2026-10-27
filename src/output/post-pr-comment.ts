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

interface TokenIdentity {
  login: string | null;
  error?: string;
}

// Any PR participant can post a comment containing the marker; only a comment written by
// this token's identity may be adopted, or a stranger could hijack/suppress the summary and
// feed forged job state into the merge.
async function resolveTokenIdentity(octokit: Octokit): Promise<TokenIdentity> {
  try {
    const result = await octokit.graphql<{ viewer?: { login?: string } }>(
      'query { viewer { login } }',
    );
    return { login: result?.viewer?.login || null };
  } catch (err) {
    core.debug(
      `Could not resolve the github-token identity (${(err as Error).message}); assuming ${ACTIONS_BOT_LOGIN}.`,
    );
    return { login: null, error: (err as Error).message };
  }
}

interface ExistingComment {
  own?: IssueComment;
  // A marker comment that may be ours but couldn't be verified as such.
  unverified?: IssueComment;
  identityError?: string;
}

// Pages lazily and resolves the token identity only once a marker comment turns up, so the
// common cases (first page has our comment, or no summary yet) cost one or two requests.
async function findOwnComment(
  octokit: Octokit,
  params: { owner: string; repo: string; issue_number: number },
): Promise<ExistingComment> {
  let identity: TokenIdentity | undefined;
  let unverified: IssueComment | undefined;
  const pages = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    ...params,
    per_page: 100,
  });
  for await (const { data } of pages) {
    for (const comment of data as IssueComment[]) {
      if (!comment.body?.includes(COMMENT_MARKER)) continue;
      identity ??= await resolveTokenIdentity(octokit);
      if (isOwnComment(comment, identity.login)) return { own: comment };
      if (!identity.login) unverified ??= comment;
    }
  }
  return { unverified, identityError: identity?.error };
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

    const {
      own: existing,
      unverified,
      identityError,
    } = await findOwnComment(octokit, {
      owner,
      repo,
      issue_number: prNumber,
    });

    if (!existing && unverified) {
      core.warning(
        `Could not verify the github-token identity (${identityError ?? 'no login returned'}), so the existing TestGlance comment by ${unverified.user?.login} was not reused; posting a new comment.`,
      );
    }

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
