import { describe, it, expect } from 'vitest';
import { detectFormat } from '../detect-format';

describe('detectFormat', () => {
  it('returns junit for .xml extension', () => {
    expect(detectFormat('report.xml')).toBe('junit');
  });

  it('returns ctrf for .json extension', () => {
    expect(detectFormat('results.json')).toBe('ctrf');
  });

  it('returns junit for .XML extension (case insensitive)', () => {
    expect(detectFormat('report.XML')).toBe('junit');
  });

  it('returns ctrf for .JSON extension (case insensitive)', () => {
    expect(detectFormat('results.JSON')).toBe('ctrf');
  });

  it('returns null for .txt extension', () => {
    expect(detectFormat('report.txt')).toBeNull();
  });

  it('returns null for no extension', () => {
    expect(detectFormat('report')).toBeNull();
  });

  it('detects format from complex path with multiple dots', () => {
    expect(detectFormat('/path/to/report.results.xml')).toBe('junit');
  });

  it('detects format from complex path with json', () => {
    expect(detectFormat('/path/to/ctrf-report.output.json')).toBe('ctrf');
  });

  it('returns null for empty string', () => {
    expect(detectFormat('')).toBeNull();
  });
});
