import { readFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';

export type CommitInfo = {
  hash: string;
  message: string;
};

export type DiffStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'type-changed' | 'unknown';

export type DiffFileSummary = {
  path: string;
  status: DiffStatus;
  additions: number;
  deletions: number;
  oldPath?: string;
  newPath?: string;
};

export type DiffSummary = {
  files: DiffFileSummary[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
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

export async function getDiffSummary(
  git: SimpleGit,
  from: string,
  to: string,
  commits: CommitInfo[],
  filterByCommits: boolean,
  ignorePackageDirectories?: string[],
  repoRootOverride?: string
): Promise<DiffSummary> {
  const ctx = await getPackageGitContext(git, ignorePackageDirectories, repoRootOverride);
  if (!ctx) {
    return { files: [], totalFiles: 0, totalAdditions: 0, totalDeletions: 0 };
  }

  const { specs } = ctx;

  if (!filterByCommits) {
    const [numOutput, nameOutput] = await Promise.all([
      git.diff(['--numstat', `${from}..${to}`, '--', ...specs]),
      git.diff(['--name-status', `${from}..${to}`, '--', ...specs]),
    ]);
    return buildDiffSummaryFromGitOutputs(nameOutput, numOutput);
  }

  const pairs = await Promise.all(
    commits.map(async (c) => {
      const range = `${c.hash}^!`;
      const [numOutput, nameOutput] = await Promise.all([
        git.diff(['--numstat', range, '--', ...specs]),
        git.diff(['--name-status', range, '--', ...specs]),
      ]);
      return { numOutput, nameOutput };
    })
  );
  const nameJoined = pairs
    .map((p) => p.nameOutput)
    .filter(Boolean)
    .join('\n');
  const numJoined = pairs
    .map((p) => p.numOutput)
    .filter(Boolean)
    .join('\n');
  return buildDiffSummaryFromGitOutputs(nameJoined, numJoined);
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

function mapGitStatus(statusCode: string): DiffStatus {
  if (statusCode.startsWith('A')) return 'added';
  if (statusCode.startsWith('D')) return 'deleted';
  if (statusCode.startsWith('R')) return 'renamed';
  if (statusCode.startsWith('C')) return 'copied';
  if (statusCode.startsWith('T')) return 'type-changed';
  if (statusCode.startsWith('M')) return 'modified';
  return 'unknown';
}

function mergeStatus(existing: DiffStatus, next: DiffStatus): DiffStatus {
  if (existing === next) return existing;
  const precedence: DiffStatus[] = ['deleted', 'added', 'renamed', 'copied', 'type-changed', 'modified', 'unknown'];
  return precedence.indexOf(existing) <= precedence.indexOf(next) ? existing : next;
}

type ParsedNameEntry = {
  path: string;
  status: DiffStatus;
  oldPath?: string;
};

function parseNameStatusLines(nameStatusOutput: string): ParsedNameEntry[] {
  const entries: ParsedNameEntry[] = [];
  for (const rawLine of nameStatusOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const statusToken = parts[0] ?? '';
    const status = mapGitStatus(statusToken);
    if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
      if (parts.length < 3) continue;
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath === undefined || newPath === undefined) continue;
      entries.push({ path: newPath, status, oldPath });
    } else {
      const pathOnly = parts[1];
      if (pathOnly === undefined) continue;
      entries.push({ path: pathOnly, status });
    }
  }
  return entries;
}

function mergeNameEntriesByPath(entries: ParsedNameEntry[]): Map<string, ParsedNameEntry> {
  const byPath = new Map<string, ParsedNameEntry>();
  for (const e of entries) {
    const existing = byPath.get(e.path);
    if (!existing) {
      byPath.set(e.path, { ...e });
    } else {
      existing.status = mergeStatus(existing.status, e.status);
      if (e.oldPath) {
        existing.oldPath = existing.oldPath ?? e.oldPath;
      }
    }
  }
  return byPath;
}

/** Map numstat path field (including `{old => new}` rename form) to the post-change path used as lookup key. */
function numStatPathToLookupKey(pathField: string): string {
  const brace = /^(.*)\{(.+) => (.+)\}$/.exec(pathField);
  if (!brace) {
    return pathField;
  }
  const dirRaw = brace[1];
  const toSeg = brace[3].trim();
  return `${dirRaw}${toSeg}`;
}

function accumulateNumStat(numStatOutput: string, into: Map<string, { additions: number; deletions: number }>): void {
  for (const rawLine of numStatOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const addStr = parts[0] ?? '';
    const delStr = parts[1] ?? '';
    const pathField = parts.slice(2).join('\t');

    const additions = addStr !== '-' ? Number.parseInt(addStr, 10) || 0 : 0;
    const deletions = delStr !== '-' ? Number.parseInt(delStr, 10) || 0 : 0;

    const key = numStatPathToLookupKey(pathField);
    const prev = into.get(key) ?? { additions: 0, deletions: 0 };
    into.set(key, { additions: prev.additions + additions, deletions: prev.deletions + deletions });
  }
}

function diffStatusToSyntheticPrefix(status: DiffStatus): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R100';
    case 'copied':
      return 'C100';
    case 'type-changed':
      return 'T';
    case 'modified':
      return 'M';
    default:
      return 'X';
  }
}

/**
 * Git does not combine `--numstat` and `--name-status` into one machine-readable line; using both flags
 * yields name-status only. We run each mode separately and merge into the compact shape `parseDiffSummary` expects.
 */
function buildDiffSummaryFromGitOutputs(nameStatusOutput: string, numStatOutput: string): DiffSummary {
  const numMap = new Map<string, { additions: number; deletions: number }>();
  accumulateNumStat(numStatOutput, numMap);

  const mergedName = mergeNameEntriesByPath(parseNameStatusLines(nameStatusOutput));
  const syntheticLines: string[] = [];

  for (const [path, meta] of mergedName) {
    const counts = numMap.get(path) ?? { additions: 0, deletions: 0 };
    const prefix = diffStatusToSyntheticPrefix(meta.status);
    if (meta.oldPath) {
      syntheticLines.push(`${prefix}\t${counts.additions}\t${counts.deletions}\t${meta.oldPath}\t${path}`);
    } else {
      syntheticLines.push(`${prefix}\t${counts.additions}\t${counts.deletions}\t${path}`);
    }
  }

  return parseDiffSummary(syntheticLines.join('\n'));
}

/** Exported for tests; also used to merge synthetic lines when the same path appears more than once. */
export function parseDiffSummary(diffOutput: string): DiffSummary {
  const fileMap = new Map<string, DiffFileSummary>();

  for (const rawLine of diffOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const statusToken = parts.shift() ?? '';
    const status = mapGitStatus(statusToken);
    const additions = parts[0] && parts[0] !== '-' ? Number.parseInt(parts[0], 10) || 0 : 0;
    const deletions = parts[1] && parts[1] !== '-' ? Number.parseInt(parts[1], 10) || 0 : 0;

    let oldPath: string | undefined;
    let newPath: string;
    if (parts.length === 3) {
      newPath = parts[2];
    } else if (parts.length === 4) {
      oldPath = parts[2];
      newPath = parts[3];
    } else {
      continue;
    }

    const path = newPath;
    const existing = fileMap.get(path);
    if (existing) {
      existing.additions += additions;
      existing.deletions += deletions;
      existing.status = mergeStatus(existing.status, status);
      if (oldPath) existing.oldPath = existing.oldPath ?? oldPath;
      existing.newPath = existing.newPath ?? newPath;
    } else {
      fileMap.set(path, {
        path,
        status,
        additions,
        deletions,
        oldPath,
        newPath: oldPath ? newPath : undefined,
      });
    }
  }

  const files = Array.from(fileMap.values());
  return {
    files,
    totalFiles: files.length,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
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
