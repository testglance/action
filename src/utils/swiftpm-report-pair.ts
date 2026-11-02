import * as core from '@actions/core';
import { discoverReportFiles } from './discover-files';

const SWIFT_TESTING_SUFFIX = '-swift-testing.xml';

function pairedReportPath(file: string): string | null {
  if (file.endsWith(SWIFT_TESTING_SUFFIX)) {
    return `${file.slice(0, -SWIFT_TESTING_SUFFIX.length)}.xml`;
  }
  return file.endsWith('.xml') ? `${file.slice(0, -'.xml'.length)}${SWIFT_TESTING_SUFFIX}` : null;
}

// SwiftPM splits one --xunit-output run across two files: XCTest in the named file and Swift
// Testing beside it. Reading only one reports half the run, and can pass with failures unread.
export async function withSwiftPmReportPairs(files: string[]): Promise<string[]> {
  const allFiles = new Set(files);
  for (const file of files) {
    const paired = pairedReportPath(file);
    if (!paired) continue;
    for (const found of await discoverReportFiles(paired)) {
      if (!allFiles.has(found)) {
        core.info(`Also reading ${found}, the other half of the SwiftPM report ${file}`);
        allFiles.add(found);
      }
    }
  }
  return [...allFiles].sort();
}
