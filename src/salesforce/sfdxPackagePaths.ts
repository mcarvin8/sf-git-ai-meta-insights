import { readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

import { getRepoRoot } from '@mcarvin/smart-diff';

const SFDX_PROJECT_FILE_NAME = 'sfdx-project.json';

/** Git client shape from `@mcarvin/smart-diff` (backed by `simple-git` transitively). */
export type GitClient = Parameters<typeof getRepoRoot>[0];

/** Normalize a repo-relative folder path for comparisons and git pathspecs (forward slashes, trimmed). */
export function normalizeRepoRelativeFolderPath(repoRelativePath: string): string {
  const trimmed = repoRelativePath.trim().replace(/\\/g, '/');
  return trimmed.replace(/^\/+/, '');
}

/**
 * Package directory paths from `sfdx-project.json`, relative to the repo root (forward slashes),
 * after applying optional `--exclude-package-directory` exclusions.
 */
export async function getSalesforceMetadataIncludeFolders(
  git: GitClient,
  ignorePackageDirectories?: string[],
  repoRootOverride?: string
): Promise<string[]> {
  const repoRoot = repoRootOverride ?? (await getRepoRoot(git));
  return readPackageDirectoryRelativePaths(repoRoot, ignorePackageDirectories);
}

export async function readPackageDirectoryRelativePaths(
  repoRoot: string,
  ignorePackageDirectories?: string[]
): Promise<string[]> {
  const projectPath = join(repoRoot, SFDX_PROJECT_FILE_NAME);

  let project: {
    packageDirectories?: Array<{ path: string } | string>;
  };

  try {
    const raw = await readFile(projectPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    project = parsed as {
      packageDirectories?: Array<{ path: string } | string>;
    };
  } catch {
    return [];
  }

  const dirs = (project.packageDirectories ?? [])
    .map((d) => (typeof d === 'string' ? d : d?.path))
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    .map((d) => d.trim());

  if (dirs.length === 0) return [];

  const ignored = (ignorePackageDirectories ?? []).map((d) => d.replace(/\\/g, '/').toLowerCase());

  const kept = dirs.filter((dir) => {
    const normalized = dir.replace(/\\/g, '/').toLowerCase();
    return !ignored.some((ign) => normalized === ign || normalized.startsWith(ign + '/'));
  });

  return kept.map((dir) => {
    const abs = resolve(repoRoot, dir);
    const rel = relative(repoRoot, abs);
    const norm = rel === '' ? '.' : rel.replace(/\\/g, '/');
    return norm;
  });
}
