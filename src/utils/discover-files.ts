import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import * as core from '@actions/core';
import fg from 'fast-glob';

const GLOB_CHARS = /[*?{[]/;

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// The workspace holds the (possibly PR-controlled) checkout, so a planted symlink there must
// not let the action read files elsewhere on the runner. Paths the workflow author points at
// outside the workspace (e.g. RUNNER_TEMP) are their explicit choice and stay allowed.
function escapesWorkspace(file: string): boolean {
  const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const workspaceReal = safeRealpath(workspace) ?? workspace;
  const lexical = resolve(file);
  if (!isWithin(lexical, workspace) && !isWithin(lexical, workspaceReal)) return false;

  const real = safeRealpath(lexical);
  return real === null || !isWithin(real, workspaceReal);
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function confineToWorkspace(files: string[]): string[] {
  return files.filter((file) => {
    if (!escapesWorkspace(file)) return true;
    core.warning(`Skipping report file ${file}: it resolves outside the workspace.`);
    return false;
  });
}

export async function discoverReportFiles(pattern: string): Promise<string[]> {
  if (!GLOB_CHARS.test(pattern)) {
    return existsSync(pattern) ? confineToWorkspace([pattern]) : [];
  }

  // Directory symlinks are not traversed, but file symlinks are still matched (onlyFiles would
  // drop them) so they can be confined below instead of silently ignored.
  const entries = await fg(pattern, {
    absolute: true,
    onlyFiles: false,
    followSymbolicLinks: false,
  });
  return confineToWorkspace(entries.filter(isRegularFile)).sort();
}
