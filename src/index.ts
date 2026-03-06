import * as core from '@actions/core';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseJunitXml } from './parsers/junit';
import { parseCtrfJson } from './parsers/ctrf';

type ReportFormat = 'junit' | 'ctrf' | 'auto';

const VALID_FORMATS: ReadonlySet<string> = new Set(['junit', 'ctrf', 'auto']);

function detectFormat(filePath: string, explicit: string): ReportFormat {
  if (explicit && explicit !== 'auto') {
    if (!VALID_FORMATS.has(explicit)) {
      core.warning(
        `Unrecognized report-format "${explicit}". Valid values: junit, ctrf, auto. Falling back to auto-detect.`,
      );
    } else {
      return explicit as ReportFormat;
    }
  }
  const ext = extname(filePath).toLowerCase();
  if (ext === '.xml') return 'junit';
  if (ext === '.json') return 'ctrf';
  core.warning(
    `Could not detect report format from extension "${ext}". Defaulting to junit.`,
  );
  return 'junit';
}

async function run(): Promise<void> {
  try {
    const reportPath = core.getInput('report-path', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const format = detectFormat(reportPath, core.getInput('report-format'));

    if (apiKey) {
      core.info('API key provided (submission will be enabled in a future release)');
    }

    const content = readFileSync(reportPath, 'utf-8');

    if (format === 'junit') {
      const result = parseJunitXml(content);
      core.info(
        `Parsed ${result.summary.total} tests: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped, ${result.summary.errored} errored`,
      );
    } else if (format === 'ctrf') {
      const result = parseCtrfJson(content);
      core.info(
        `Parsed ${result.summary.total} tests: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped, ${result.summary.errored} errored`,
      );
    }
  } catch (err) {
    core.warning(
      `TestGlance encountered an error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

run();
