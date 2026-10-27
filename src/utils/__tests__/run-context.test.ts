import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockContext = vi.hoisted(() => ({
  eventName: 'push',
  sha: 'default-sha',
  payload: {} as Record<string, unknown>,
}));

vi.mock('@actions/github', () => ({ context: mockContext }));

import { resolveRunIdentity } from '../run-context';

const BASE_REPO = { full_name: 'owner/repo' };
const ENV_KEYS = ['GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_SHA'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.GITHUB_HEAD_REF;
  process.env.GITHUB_REF_NAME = 'main';
  process.env.GITHUB_SHA = 'default-sha';
  mockContext.eventName = 'push';
  mockContext.sha = 'default-sha';
  mockContext.payload = {};
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('resolveRunIdentity', () => {
  describe('pull_request_target', () => {
    beforeEach(() => {
      mockContext.eventName = 'pull_request_target';
      process.env.GITHUB_HEAD_REF = 'main';
    });

    it('skips history when the head repository is unknown (deleted fork)', () => {
      mockContext.payload = {
        repository: BASE_REPO,
        pull_request: { head: { ref: 'main', sha: 'head-sha', repo: null } },
      };

      expect(resolveRunIdentity().historyBranch).toBeNull();
    });

    it('records the PR head commit rather than the base branch HEAD', () => {
      mockContext.payload = {
        repository: BASE_REPO,
        pull_request: { head: { ref: 'main', sha: 'head-sha', repo: BASE_REPO } },
      };

      expect(resolveRunIdentity()).toMatchObject({
        checkRunSha: 'head-sha',
        commitSha: 'head-sha',
        historyBranch: 'main',
      });
    });
  });

  describe('pull_request', () => {
    it('keeps the plain head branch when the head repository is unknown', () => {
      mockContext.eventName = 'pull_request';
      process.env.GITHUB_HEAD_REF = 'feature';
      mockContext.payload = {
        repository: BASE_REPO,
        pull_request: { head: { ref: 'feature', sha: 'head-sha', repo: null } },
      };

      expect(resolveRunIdentity()).toMatchObject({
        checkRunSha: 'head-sha',
        commitSha: 'default-sha',
        historyBranch: 'feature',
      });
    });
  });

  describe('issue_comment', () => {
    beforeEach(() => {
      mockContext.eventName = 'issue_comment';
    });

    it('attaches the check run to GITHUB_SHA for a comment on a plain issue', () => {
      mockContext.payload = { issue: { number: 3 } };

      expect(resolveRunIdentity()).toMatchObject({
        checkRunSha: 'default-sha',
        historyBranch: 'main',
      });
    });

    it('skips the check run and history for a comment on a pull request', () => {
      mockContext.payload = { issue: { number: 3, pull_request: { url: 'https://x' } } };

      expect(resolveRunIdentity()).toMatchObject({ checkRunSha: null, historyBranch: null });
    });
  });
});
