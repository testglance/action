import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockWarning = vi.hoisted(() => vi.fn());
vi.mock('@actions/core', () => ({ warning: mockWarning }));

import { discoverReportFiles } from '../discover-files';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'discover-files-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('discoverReportFiles', () => {
  describe('literal path (no glob characters)', () => {
    it('returns single-element array when file exists', async () => {
      const filePath = join(tmpDir, 'report.xml');
      writeFileSync(filePath, '<xml/>');

      const result = await discoverReportFiles(filePath);
      expect(result).toEqual([filePath]);
    });

    it('returns empty array when file does not exist', async () => {
      const result = await discoverReportFiles(join(tmpDir, 'missing.xml'));
      expect(result).toEqual([]);
    });
  });

  describe('glob patterns', () => {
    it('discovers multiple files matching a glob', async () => {
      writeFileSync(join(tmpDir, 'a.xml'), '<xml/>');
      writeFileSync(join(tmpDir, 'b.xml'), '<xml/>');
      writeFileSync(join(tmpDir, 'c.json'), '{}');

      const result = await discoverReportFiles(join(tmpDir, '*.xml'));
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('a.xml');
      expect(result[1]).toContain('b.xml');
    });

    it('discovers files in subdirectories with ** glob', async () => {
      const sub = join(tmpDir, 'sub');
      mkdirSync(sub);
      writeFileSync(join(tmpDir, 'root.xml'), '<xml/>');
      writeFileSync(join(sub, 'nested.xml'), '<xml/>');

      const result = await discoverReportFiles(join(tmpDir, '**/*.xml'));
      expect(result).toHaveLength(2);
    });

    it('returns empty array when glob matches no files', async () => {
      const result = await discoverReportFiles(join(tmpDir, '*.xml'));
      expect(result).toEqual([]);
    });

    it('returns sorted paths', async () => {
      writeFileSync(join(tmpDir, 'z.xml'), '<xml/>');
      writeFileSync(join(tmpDir, 'a.xml'), '<xml/>');
      writeFileSync(join(tmpDir, 'm.xml'), '<xml/>');

      const result = await discoverReportFiles(join(tmpDir, '*.xml'));
      const names = result.map((p) => p.split('/').pop());
      expect(names).toEqual(['a.xml', 'm.xml', 'z.xml']);
    });
  });

  describe('workspace confinement', () => {
    let workspace: string;
    let outside: string;
    let prevWorkspace: string | undefined;

    beforeEach(() => {
      mockWarning.mockClear();
      workspace = join(tmpDir, 'ws');
      outside = join(tmpDir, 'outside');
      mkdirSync(workspace);
      mkdirSync(outside);
      writeFileSync(join(outside, 'secret.xml'), '<secret/>');
      writeFileSync(join(workspace, 'real.xml'), '<xml/>');
      prevWorkspace = process.env.GITHUB_WORKSPACE;
      process.env.GITHUB_WORKSPACE = workspace;
    });

    afterEach(() => {
      if (prevWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
      else process.env.GITHUB_WORKSPACE = prevWorkspace;
    });

    it('skips a workspace file symlinked to a file outside the workspace (glob)', async () => {
      symlinkSync(join(outside, 'secret.xml'), join(workspace, 'link.xml'));

      const result = await discoverReportFiles(join(workspace, '*.xml'));

      expect(result).toEqual([join(workspace, 'real.xml')]);
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('outside the workspace'));
    });

    it('skips a workspace file symlinked outside the workspace (literal path)', async () => {
      symlinkSync(join(outside, 'secret.xml'), join(workspace, 'link.xml'));

      const result = await discoverReportFiles(join(workspace, 'link.xml'));

      expect(result).toEqual([]);
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('outside the workspace'));
    });

    it('does not follow a symlinked directory out of the workspace', async () => {
      symlinkSync(outside, join(workspace, 'test-results'), 'dir');

      const result = await discoverReportFiles(join(workspace, '**/*.xml'));

      expect(result).toEqual([join(workspace, 'real.xml')]);
    });

    it('keeps a symlink that stays inside the workspace', async () => {
      mkdirSync(join(workspace, 'reports'));
      symlinkSync(join(workspace, 'real.xml'), join(workspace, 'reports', 'alias.xml'));

      const result = await discoverReportFiles(join(workspace, 'reports', '*.xml'));

      expect(result).toEqual([join(workspace, 'reports', 'alias.xml')]);
    });

    it('skips a `..` path that climbs out through a symlinked directory', async () => {
      mkdirSync(join(outside, 'deep'));
      symlinkSync(join(outside, 'deep'), join(workspace, 'reports'), 'dir');
      writeFileSync(join(workspace, 'secret.xml'), '<decoy/>');

      // join() would normalize the `..` away; the kernel resolves it after the symlink.
      const result = await discoverReportFiles(`${workspace}/reports/../secret.xml`);

      expect(result).toEqual([]);
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('outside the workspace'));
    });

    it('keeps a `..` path through a real directory inside the workspace', async () => {
      mkdirSync(join(workspace, 'reports'));
      const path = `${workspace}/reports/../real.xml`;

      expect(await discoverReportFiles(path)).toEqual([path]);
    });

    it('still reads an explicit path outside the workspace (e.g. RUNNER_TEMP)', async () => {
      const result = await discoverReportFiles(join(outside, 'secret.xml'));

      expect(result).toEqual([join(outside, 'secret.xml')]);
      expect(mockWarning).not.toHaveBeenCalled();
    });
  });
});
