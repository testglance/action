import * as core from '@actions/core';
import fg from 'fast-glob';
import { discoverReportFiles } from './discover-files';

const SWIFT_TESTING_SUFFIX = '-swift-testing.xml';

export async function findSwiftTestingReport(file: string): Promise<string | null> {
  if (!file.endsWith('.xml') || file.endsWith(SWIFT_TESTING_SUFFIX)) return null;

  const sibling = `${file.slice(0, -'.xml'.length)}${SWIFT_TESTING_SUFFIX}`;
  const [found] = await discoverReportFiles(fg.escapePath(sibling));
  return found ?? null;
}

// SwiftPM splits one --xunit-output run across two files, so naming only the first can pass with
// failures unread. It only warns, because a workflow may report each file in its own step, and the
// file beside it may be left over from an earlier run.
export async function warnAboutUnreadSwiftTestingReports(files: string[]): Promise<void> {
  for (const file of files) {
    const sibling = await findSwiftTestingReport(file);
    if (sibling && !files.includes(sibling)) {
      core.warning(
        `${sibling} is beside ${file} but report-path does not include it, so its results are not reported. If SwiftPM wrote both, use a glob such as *.xml or leave report-path empty.`,
      );
    }
  }
}
