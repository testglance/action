import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PrCommentSection } from '../pr-comment';

const mockWarning = vi.fn();
const mockSetFailed = vi.fn();

vi.mock('@actions/core', () => ({
  warning: (...args: unknown[]) => mockWarning(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
}));

const mockListComments = vi.fn();
const mockCreateComment = vi.fn();
const mockUpdateComment = vi.fn();

const mockGetOctokit = vi.fn(() => ({
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
  mockListComments.mockResolvedValue({ data: [] });
  mockCreateComment.mockResolvedValue({});
  mockUpdateComment.mockResolvedValue({});
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
          body: '<!-- testglance-pr-summary -->\n## 🔬 TestGlance Test Summary\n\n<!-- tj:ci/test -->\n### ✅ ci/test\n**50 tests** | 3.0s\n<!-- /tj:ci/test -->\n\n---\n*Updated 2026-03-01T00:00:00.000Z*',
        },
      ],
    });

    await postPrComment({ githubToken: 'ghp_test', section: makeSection({ total: 200 }) });

    expect(mockUpdateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 999,
        body: expect.stringContaining('**200 tests**'),
      }),
    );
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  it('skips when not in PR context', async () => {
    mockContext.payload = {};

    await postPrComment({ githubToken: 'ghp_test', section: makeSection() });

    expect(mockGetOctokit).not.toHaveBeenCalled();
    expect(mockCreateComment).not.toHaveBeenCalled();
    expect(mockWarning).not.toHaveBeenCalled();
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
});
