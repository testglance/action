import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as core from '@actions/core';
import {
  handleFileNotFound,
  handleParseError,
  handleApiUnreachable,
  handleApiError,
  handleUnexpectedError,
} from '../errors';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  setFailed: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('error handlers', () => {
  describe('handleFileNotFound', () => {
    it('calls core.warning with the file path', () => {
      handleFileNotFound('/path/to/report.xml');
      expect(core.warning).toHaveBeenCalledWith(
        'Test report file not found at /path/to/report.xml.',
      );
    });
  });

  describe('handleParseError', () => {
    it('calls core.warning with format and error message', () => {
      handleParseError('JUnit XML', new Error('Invalid XML'));
      expect(core.warning).toHaveBeenCalledWith(
        'Failed to parse test report as JUnit XML: Invalid XML',
      );
    });
  });

  describe('handleApiUnreachable', () => {
    it('calls core.warning with the standard unreachable message', () => {
      handleApiUnreachable();
      expect(core.warning).toHaveBeenCalledWith(
        'TestGlance API unreachable. Test data was not submitted. Your CI pipeline is unaffected.',
      );
    });
  });

  describe('handleApiError', () => {
    it('calls core.warning with error code and message', () => {
      handleApiError('UNAUTHORIZED', 'Invalid API key');
      expect(core.warning).toHaveBeenCalledWith(
        'TestGlance API error: UNAUTHORIZED - Invalid API key',
      );
    });
  });

  describe('handleUnexpectedError', () => {
    it('calls core.warning with error message and pipeline reassurance', () => {
      handleUnexpectedError(new Error('Something broke'));
      expect(core.warning).toHaveBeenCalledWith(
        'TestGlance encountered an unexpected error: Something broke. Your CI pipeline is unaffected.',
      );
    });
  });

  describe('no function ever calls core.setFailed (AC7)', () => {
    it('handleFileNotFound does not call setFailed', () => {
      handleFileNotFound('/any/path');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('handleParseError does not call setFailed', () => {
      handleParseError('any', new Error('fail'));
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('handleApiUnreachable does not call setFailed', () => {
      handleApiUnreachable();
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('handleApiError does not call setFailed', () => {
      handleApiError('500', 'error');
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('handleUnexpectedError does not call setFailed', () => {
      handleUnexpectedError(new Error('boom'));
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });
});
