import type { CommitInfo } from '@mcarvin/smart-diff';
import { filterCommitsByMessageRegexes } from '@mcarvin/smart-diff';
import { SgaiError } from '../errors.js';
import {
  type GitClient,
  getSalesforceMetadataIncludeFolders,
  normalizeRepoRelativeFolderPath,
} from '../salesforce/sfdxPackagePaths.js';

export function validateMaxDiffCharsRange(maxDiffChars: number | undefined): void {
  // Stryker disable-next-line ConditionalExpression
  if (maxDiffChars === undefined) return;
  if (maxDiffChars < 5000 || maxDiffChars > 5_000_000) {
    throw new SgaiError(`--max-diff-chars must be between 5000 and 5,000,000 (received ${maxDiffChars}).`, {
      name: 'InvalidMaxDiffChars',
    });
  }
}

export function validateContextLinesRange(contextLines: number | undefined): void {
  if (contextLines === undefined) return;
  if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 1000) {
    throw new SgaiError(`--context-lines must be an integer between 0 and 1000 (received ${contextLines}).`, {
      name: 'InvalidContextLines',
    });
  }
}

export function validateMaxHunkLinesRange(maxHunkLines: number | undefined): void {
  if (maxHunkLines === undefined) return;
  if (!Number.isInteger(maxHunkLines) || maxHunkLines < 1 || maxHunkLines > 100_000) {
    throw new SgaiError(`--max-hunk-lines must be an integer between 1 and 100,000 (received ${maxHunkLines}).`, {
      name: 'InvalidMaxHunkLines',
    });
  }
}

export function validateMaxRetriesRange(maxRetries: number | undefined): void {
  if (maxRetries === undefined) return;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new SgaiError(`--max-retries must be a non-negative integer (received ${maxRetries}).`, {
      name: 'InvalidMaxRetries',
    });
  }
}

export type CommitMessageRegexFlags = {
  'commit-message-include'?: string[];
  'commit-message-exclude'?: string[];
};

export function getValidatedCommitMessageRegexLists(flags: CommitMessageRegexFlags): {
  include: string[];
  exclude: string[];
} {
  const include = mergeUniqueStrings(
    (flags['commit-message-include'] ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
  );
  const exclude = (flags['commit-message-exclude'] ?? []).map((s) => s.trim()).filter((s) => s.length > 0);

  // Stryker disable-next-line ConditionalExpression, EqualityOperator
  if (include.length > 0) {
    validateCommitMessageRegexes(include, 'include');
  }
  // Stryker disable-next-line ConditionalExpression, EqualityOperator
  if (exclude.length > 0) {
    validateCommitMessageRegexes(exclude, 'exclude');
  }

  return { include, exclude };
}

export type PackageDirectoryFlags = {
  'exclude-package-directory'?: string[];
  'include-package-directory'?: string[];
};

export async function resolveIncludeFoldersAndExclude(
  git: GitClient,
  flags: PackageDirectoryFlags,
): Promise<{ includeFolders: string[]; excludePackageDirectories: string[] }> {
  const excludePackageDirectories = mergeUniqueRepoRelativePaths(flags['exclude-package-directory'] ?? []);
  const includeFoldersFromProject = await getSalesforceMetadataIncludeFolders(
    git,
    excludePackageDirectories.length > 0 ? excludePackageDirectories : undefined,
  );
  const includeFoldersFromCli = mergeUniqueRepoRelativePaths(flags['include-package-directory'] ?? []);
  const includeFolders = mergeUniqueRepoRelativePaths(includeFoldersFromProject, includeFoldersFromCli);
  return { includeFolders, excludePackageDirectories };
}

export function throwIfNoCommitsAfterMessageFilter(
  commits: CommitInfo[],
  filteredCommits: CommitInfo[],
  includeRegexes: string[],
  excludeRegexes: string[],
  errorMessage: string,
): void {
  if (commits.length > 0 && filteredCommits.length === 0 && (includeRegexes.length > 0 || excludeRegexes.length > 0)) {
    throw new SgaiError(errorMessage, { name: 'NoCommitsAfterFilter' });
  }
}

export function validateCommitMessageRegexes(patterns: string[], kind: 'include' | 'exclude'): void {
  for (const pattern of patterns) {
    try {
      filterCommitsByMessageRegexes(
        // Stryker disable-next-line ArrayDeclaration, ObjectLiteral, StringLiteral
        [{ hash: '_', message: ' ' }],
        kind === 'include' ? [pattern] : undefined,
        // Stryker disable-next-line ConditionalExpression
        kind === 'exclude' ? [pattern] : undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needle =
        kind === 'include' ? 'Invalid commit message include pattern' : 'Invalid commit message exclude pattern';
      if (message.includes(needle)) {
        throw new SgaiError(`Invalid commit message ${kind} regular expression: ${JSON.stringify(pattern)}`, {
          name: kind === 'include' ? 'InvalidMessageInclude' : 'InvalidMessageExclude',
          cause: err,
        });
      }
      throw err;
    }
  }
}

export function mergeUniqueStrings(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const s of group) {
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export function mergeUniqueRepoRelativePaths(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const norm = normalizeRepoRelativeFolderPath(raw);
      if (norm.length === 0 || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
