import * as core from '@actions/core';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export function handleFileNotFound(path: string): void {
  core.warning(`Test report file not found at ${path}.`);
}

export function handleParseError(format: string, error: Error): void {
  core.warning(`Failed to parse test report as ${format}: ${error.message}`);
}

export function handleApiUnreachable(): void {
  core.warning(
    'TestGlance API unreachable. Test data was not submitted. Your CI pipeline is unaffected.',
  );
}

export function handleApiError(code: string, message: string): void {
  core.warning(`TestGlance API error: ${code} - ${message}`);
}

export function handleUnexpectedError(error: Error): void {
  core.warning(
    `TestGlance encountered an unexpected error: ${error.message}. Your CI pipeline is unaffected.`,
  );
}
