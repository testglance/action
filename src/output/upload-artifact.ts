import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function uploadArtifact(html: string, artifactName: string): Promise<void> {
  const tmpPath = join(tmpdir(), 'testglance-report.html');
  try {
    writeFileSync(tmpPath, html, 'utf-8');
    const client = new DefaultArtifactClient();
    await client.uploadArtifact(artifactName, [tmpPath], tmpdir());
    core.info(`HTML report uploaded as artifact "${artifactName}"`);
  } catch (err) {
    core.warning(
      `Failed to upload HTML report artifact: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // temp file cleanup is best-effort
    }
  }
}
