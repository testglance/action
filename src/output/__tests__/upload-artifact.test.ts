import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUploadArtifact = vi.fn();
vi.mock('@actions/artifact', () => ({
  DefaultArtifactClient: vi.fn().mockImplementation(function () {
    return { uploadArtifact: mockUploadArtifact };
  }),
}));

const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

const mockWarning = vi.fn();
const mockInfo = vi.fn();
vi.mock('@actions/core', () => ({
  warning: (...args: unknown[]) => mockWarning(...args),
  info: (...args: unknown[]) => mockInfo(...args),
}));

import { uploadArtifact } from '../upload-artifact';

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadArtifact.mockResolvedValue({ id: 1 });
});

describe('uploadArtifact', () => {
  it('writes HTML to temp file and uploads', async () => {
    await expect(uploadArtifact('<html>report</html>', 'testglance-report')).resolves.toBe(true);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('testglance-report-'),
      '<html>report</html>',
      'utf-8',
    );
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      'testglance-report',
      [expect.stringContaining('testglance-report-')],
      expect.any(String),
    );
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('uploaded'));
  });

  it('uses custom artifact name', async () => {
    await expect(uploadArtifact('<html></html>', 'my-custom-report')).resolves.toBe(true);

    expect(mockUploadArtifact).toHaveBeenCalledWith(
      'my-custom-report',
      expect.any(Array),
      expect.any(String),
    );
  });

  it('cleans up temp file after successful upload', async () => {
    await uploadArtifact('<html></html>', 'test');

    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining('testglance-report-'));
  });

  it('logs warning on upload failure without throwing', async () => {
    mockUploadArtifact.mockRejectedValue(new Error('upload failed'));

    await expect(uploadArtifact('<html></html>', 'test')).resolves.toBe(false);

    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('upload failed'));
  });

  it('cleans up temp file even on upload failure', async () => {
    mockUploadArtifact.mockRejectedValue(new Error('network error'));

    await uploadArtifact('<html></html>', 'test');

    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('handles temp file cleanup failure gracefully', async () => {
    mockUnlinkSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    await expect(uploadArtifact('<html></html>', 'test')).resolves.toBe(true);
  });
});
