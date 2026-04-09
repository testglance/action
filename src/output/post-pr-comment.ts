import * as core from '@actions/core';
import * as github from '@actions/github';
import type { PrCommentSection } from './pr-comment';
import { renderPrComment, mergeTestJobSection } from './pr-comment';

export interface PostPrCommentOptions {
  githubToken: string;
  section: PrCommentSection;
}

const COMMENT_MARKER = '<!-- testglance-pr-summary -->';

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

    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });

    const existing = comments.find((c: { body?: string | null; id: number }) =>
      c.body?.includes(COMMENT_MARKER),
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
