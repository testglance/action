import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
});
