import { readFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';

export type CommitInfo = {
  hash: string;
  message: string;
};

const SFDX_PROJECT_FILE_NAME = 'sfdx-project.json';

type PackageGitContext = {
  repoRoot: string;
  specs: string[];
  packagePaths: string[];
};

export function createGitClient(cwd = process.cwd()): SimpleGit {
  return simpleGit(cwd);
}

export async function getCommits(git: SimpleGit, from: string, to: string): Promise<CommitInfo[]> {
  const logResult = await git.log({ from, to });
  return logResult.all as unknown as CommitInfo[];
}

export function filterCommits(commits: CommitInfo[], messageFilter?: string): CommitInfo[] {
  if (messageFilter === undefined || messageFilter.trim() === '') {
    return commits;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(messageFilter, 'i');
  } catch {
    throw new Error(`Invalid commit message filter regular expression: ${JSON.stringify(messageFilter)}`);
  }
  return commits.filter((c) => regex.test(c.message));
}

export async function getRepoRoot(git: SimpleGit): Promise<string> {
  const root = await git.revparse(['--show-toplevel']);
  return root.trim();
}

async function getPackageGitContext(
  git: SimpleGit,
  ignorePackageDirectories: string[] | undefined,
  repoRootOverride?: string
): Promise<PackageGitContext | null> {
  const repoRoot = repoRootOverride ?? (await getRepoRoot(git));
  const packagePaths = await getPackageDirectoryPaths(ignorePackageDirectories, repoRoot);

  if (packagePaths.length === 0) return null;

  const specs = packagePaths.map((p) => {
    const rel = relative(repoRoot, p);
    return rel === '' ? '.' : rel;
  });

  return { repoRoot, specs, packagePaths };
}

export async function getDiff(
  git: SimpleGit,
  from: string,
  to: string,
  commits: CommitInfo[],
  filterByCommits: boolean,
  ignorePackageDirectories?: string[],
  repoRootOverride?: string
): Promise<string> {
  const ctx = await getPackageGitContext(git, ignorePackageDirectories, repoRootOverride);
  if (!ctx) return '';

  const { specs } = ctx;

  if (!filterByCommits) {
    return git.diff([`${from}..${to}`, '--', ...specs]);
  }

  const patches = await Promise.all(commits.map((c) => git.diff([`${c.hash}^!`, '--', ...specs])));

  return patches.filter(Boolean).join('\n');
}

export async function getChangedFiles(
  git: SimpleGit,
  from: string,
  to: string,
  commits: CommitInfo[],
  filterByCommits: boolean,
  ignorePackageDirectories?: string[],
  repoRootOverride?: string
): Promise<string[]> {
  const ctx = await getPackageGitContext(git, ignorePackageDirectories, repoRootOverride);
  if (!ctx) return [];

  const { repoRoot, specs, packagePaths } = ctx;

  const matchesPackage = (file: string): boolean => {
    const resolved = resolve(repoRoot, file);
    return packagePaths.some((pkg) => resolved === pkg || resolved.startsWith(pkg + sep));
  };

  if (!filterByCommits) {
    const output = await git.diff(['--name-only', `${from}..${to}`, '--', ...specs]);

    return output
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean)
      .filter(matchesPackage);
  }

  const fileSet = new Set<string>();

  await Promise.all(
    commits.map(async (c) => {
      const output = await git.show(['--name-only', '--pretty=format:', c.hash, '--', ...specs]);

      output
        .split(/\r?\n/)
        .map((f) => f.trim())
        .filter(Boolean)
        .filter(matchesPackage)
        .forEach((f) => fileSet.add(f));
    })
  );

  return Array.from(fileSet);
}

async function getPackageDirectoryPaths(
  ignorePackageDirectories: string[] | undefined,
  repoRoot: string
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

  return dirs
    .filter((dir) => {
      const normalized = dir.replace(/\\/g, '/').toLowerCase();

      return !ignored.some((ign) => normalized === ign || normalized.startsWith(ign + '/'));
    })
    .map((dir) => resolve(repoRoot, dir));
}
