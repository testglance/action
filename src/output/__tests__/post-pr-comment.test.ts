import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PrCommentSection } from '../pr-comment';

const mockWarning = vi.fn();
const mockSetFailed = vi.fn();
const mockDebug = vi.fn();

vi.mock('@actions/core', () => ({
  warning: (...args: unknown[]) => mockWarning(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  debug: (...args: unknown[]) => mockDebug(...args),
}));

const mockListComments = vi.fn();
const mockCreateComment = vi.fn();
const mockUpdateComment = vi.fn();
const mockGraphql = vi.fn();
const mockPaginate = vi.fn(
  async (
    method: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>,
    params: Record<string, unknown>,
  ) => {
    const all: unknown[] = [];
    for (let page = 1; ; page++) {
      const { data } = await method({ ...params, page });
      all.push(...data);
      if (data.length < ((params.per_page as number) ?? 30)) return all;
    }
  },
);

const mockGetOctokit = vi.fn(() => ({
  graphql: mockGraphql,
  paginate: mockPaginate,
  rest: {
    issues: {
      listComments: mockListComments,
      createComment: mockCreateComment,
      updateComment: mockUpdateComment,
    },
  },
}));

const mockContext = vi.hoisted(() => ({
  repo: { owner: 'test-owner', repo: 'test-repo' },
  payload: { pull_request: { number: 42 } } as Record<string, unknown>,
  issue: { number: 42 },
}));

vi.mock('@actions/github', () => ({
  getOctokit: (...args: unknown[]) => mockGetOctokit(...args),
  context: mockContext,
}));

import { postPrComment } from '../post-pr-comment';

const MARKER = '<!-- testglance-pr-summary -->';
const ACTIONS_BOT = { login: 'github-actions[bot]', type: 'Bot' };

function makeSection(overrides: Partial<PrCommentSection> = {}): PrCommentSection {
  return {
    testJobName: 'ci/test',
    status: 'passed',
    total: 100,
    passed: 100,
    failed: 0,
    duration: 5.0,
    healthScore: 90,
    highlights: [],
    runUrl: 'https://www.testglance.dev/runs/run_1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.payload = { pull_request: { number: 42 } };
  mockContext.issue = { number: 42 } as typeof mockContext.issue;
  mockListComments.mockResolvedValue({ data: [] });
  mockCreateComment.mockResolvedValue({});
  mockUpdateComment.mockResolvedValue({});
  mockGraphql.mockResolvedValue({ viewer: { login: ACTIONS_BOT.login } });
});

describe('postPrComment', () => {
  it('posts new comment when none exists', async () => {
    mockListComments.mockResolvedValue({ data: [] });

    await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

    expect(mockGetOctokit).toHaveBeenCalledWith('ghp_test');
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 42,
        body: expect.stringContaining('<!-- testglance-pr-summary -->'),
      }),
    );
  });

  it('updates existing comment when marker found', async () => {
    mockListComments.mockResolvedValue({
      data: [
        {
          id: 999,
          user: ACTIONS_BOT,
          body: '<!-- testglance-pr-summary -->\n## 🔬 TestGlance Test Summary\n\n<!-- tj:ci/test -->\n### ✅ ci/test\n**50 tests** | 3.0s\n<!-- /tj:ci/test -->\n\n---\n*Updated 2026-03-01T00:00:00.000Z*',
        },
      ],
    });

    await postPrComment({
      githubToken: 'ghp_test',
      section: makeSection({ total: 200, passed: 200 }),
    });

    expect(mockUpdateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 999,
        body: expect.stringContaining('✅ 200 passed'),
      }),
    );
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it('skips when not in PR context', async () => {
    mockContext.payload = {};
    mockContext.issue = { number: 0 } as typeof mockContext.issue;

    await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

    expect(mockGetOctokit).not.toHaveBeenCalled();
    expect(mockCreateComment).not.toHaveBeenCalled();
    expect(mockWarning).not.toHaveBeenCalled();
  });

  it('falls back to issue.number for issue_comment events on PRs', async () => {
    mockContext.payload = {};
    mockContext.issue = { number: 77 } as typeof mockContext.issue;

    await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

    expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 77 }));
  });

  it('skips when githubToken is empty', async () => {
    await postPrComment({ githubToken: '', section: makeSection() });

    expect(mockGetOctokit).not.toHaveBeenCalled();
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it('logs warning and continues on API error', async () => {
    mockListComments.mockRejectedValue(new Error('API rate limit'));

    await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Failed to post PR comment'));
  });

  it('never calls core.setFailed', async () => {
    mockListComments.mockRejectedValue(new Error('API error'));

    await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  describe('comment ownership', () => {
    const botComment = (id: number, user = ACTIONS_BOT) => ({
      id,
      user,
      body: `${MARKER}\n## 🔬 TestGlance\n`,
    });

    it('ignores a marker comment posted by another user and updates its own comment', async () => {
      mockListComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: 'mallory', type: 'User' }, body: `${MARKER}\nhijacked` },
          botComment(999),
        ],
      });

      await postPrComment({ githubToken: 'ghs_test', section: makeSection() });

      expect(mockUpdateComment).toHaveBeenCalledTimes(1);
      expect(mockUpdateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 999 }));
    });

    it('creates a fresh comment when the only marker comment belongs to someone else', async () => {
      mockListComments.mockResolvedValue({
        data: [{ id: 1, user: { login: 'mallory', type: 'User' }, body: `${MARKER}\nhijacked` }],
      });

      await postPrComment({ githubToken: 'ghs_test', section: makeSection() });

      expect(mockUpdateComment).not.toHaveBeenCalled();
      expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 42 }));
    });

    it("matches the token's own login when it is a user (PAT) token", async () => {
      mockGraphql.mockResolvedValue({ viewer: { login: 'ci-user' } });
      mockListComments.mockResolvedValue({
        data: [botComment(5), botComment(6, { login: 'ci-user', type: 'User' })],
      });

      await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

      expect(mockUpdateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 6 }));
    });

    it('falls back to github-actions[bot] when the token identity cannot be resolved', async () => {
      mockGraphql.mockRejectedValue(new Error('Resource not accessible by integration'));
      mockListComments.mockResolvedValue({
        data: [botComment(3, { login: 'other-app[bot]', type: 'Bot' }), botComment(4)],
      });

      await postPrComment({ githubToken: 'ghs_test', section: makeSection() });

      expect(mockUpdateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 4 }));
      expect(mockWarning).not.toHaveBeenCalled();
    });

    it('does not trust a user account merely named like the actions bot', async () => {
      mockGraphql.mockRejectedValue(new Error('Resource not accessible by integration'));
      mockListComments.mockResolvedValue({
        data: [botComment(7, { login: 'github-actions[bot]', type: 'User' })],
      });

      await postPrComment({ githubToken: 'ghs_test', section: makeSection() });

      expect(mockUpdateComment).not.toHaveBeenCalled();
      expect(mockCreateComment).toHaveBeenCalled();
    });

    it('finds its own comment beyond the first page of comments', async () => {
      const all = [
        ...Array.from({ length: 120 }, (_, i) => ({
          id: 1000 + i,
          user: { login: 'chatty', type: 'User' },
          body: 'noise',
        })),
        botComment(42_000),
      ];
      mockListComments.mockImplementation(
        async ({ page = 1, per_page = 30 }: { page?: number; per_page?: number }) => ({
          data: all.slice((page - 1) * per_page, page * per_page),
        }),
      );

      await postPrComment({ githubToken: 'ghs_test', section: makeSection() });

      expect(mockCreateComment).not.toHaveBeenCalled();
      expect(mockUpdateComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 42_000 }),
      );
    });
  });
});
