import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SfError } from '@salesforce/core';

vi.mock('@mcarvin/smart-diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mcarvin/smart-diff')>();
  return {
    ...actual,
    filterCommitsByMessageRegexes: vi.fn((...args: Parameters<typeof actual.filterCommitsByMessageRegexes>) =>
      actual.filterCommitsByMessageRegexes(...args),
    ),
  };
});

vi.mock('../../src/salesforce/sfdxPackagePaths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/salesforce/sfdxPackagePaths.js')>();
  return {
    ...actual,
    getSalesforceMetadataIncludeFolders: vi.fn(),
  };
});

import { filterCommitsByMessageRegexes } from '@mcarvin/smart-diff';
import { getSalesforceMetadataIncludeFolders, type GitClient } from '../../src/salesforce/sfdxPackagePaths.js';
import {
  getValidatedCommitMessageRegexLists,
  mergeUniqueRepoRelativePaths,
  mergeUniqueStrings,
  resolveIncludeFoldersAndExclude,
  throwIfNoCommitsAfterMessageFilter,
  validateCommitMessageRegexes,
  validateContextLinesRange,
  validateMaxDiffCharsRange,
  validateMaxHunkLinesRange,
} from '../../src/metadata/summarizeHelpers.js';

function assertSfError(fn: () => unknown, errorName: string, messageHint: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SfError);
  expect((caught as SfError).name).toBe(errorName);
  expect((caught as SfError).message).toContain(messageHint);
}

describe('validateMaxDiffCharsRange', () => {
  it('does not throw for undefined', () => {
    expect(() => validateMaxDiffCharsRange(undefined)).not.toThrow();
  });

  it('does not throw at lower boundary (5000)', () => {
    expect(() => validateMaxDiffCharsRange(5000)).not.toThrow();
  });

  it('throws SfError below lower boundary (4999)', () => {
    assertSfError(
      () => validateMaxDiffCharsRange(4999),
      'InvalidMaxDiffChars',
      '--max-diff-chars must be between 5000',
    );
  });

  it('does not throw at upper boundary (5_000_000)', () => {
    expect(() => validateMaxDiffCharsRange(5_000_000)).not.toThrow();
  });

  it('throws SfError above upper boundary (5_000_001)', () => {
    assertSfError(() => validateMaxDiffCharsRange(5_000_001), 'InvalidMaxDiffChars', '5,000,000');
  });
});

describe('validateContextLinesRange', () => {
  it('does not throw for undefined', () => {
    expect(() => validateContextLinesRange(undefined)).not.toThrow();
  });

  it('does not throw at lower boundary (0)', () => {
    expect(() => validateContextLinesRange(0)).not.toThrow();
  });

  it('throws SfError below lower boundary (-1)', () => {
    assertSfError(
      () => validateContextLinesRange(-1),
      'InvalidContextLines',
      '--context-lines must be an integer between 0',
    );
  });

  it('does not throw at upper boundary (1000)', () => {
    expect(() => validateContextLinesRange(1000)).not.toThrow();
  });

  it('throws SfError above upper boundary (1001)', () => {
    assertSfError(() => validateContextLinesRange(1001), 'InvalidContextLines', '1000');
  });

  it('throws SfError for non-integer (1.5)', () => {
    assertSfError(() => validateContextLinesRange(1.5), 'InvalidContextLines', '--context-lines must be an integer');
  });
});

describe('validateMaxHunkLinesRange', () => {
  it('does not throw for undefined', () => {
    expect(() => validateMaxHunkLinesRange(undefined)).not.toThrow();
  });

  it('does not throw at lower boundary (1)', () => {
    expect(() => validateMaxHunkLinesRange(1)).not.toThrow();
  });

  it('throws SfError below lower boundary (0)', () => {
    assertSfError(
      () => validateMaxHunkLinesRange(0),
      'InvalidMaxHunkLines',
      '--max-hunk-lines must be an integer between 1',
    );
  });

  it('does not throw at upper boundary (100_000)', () => {
    expect(() => validateMaxHunkLinesRange(100_000)).not.toThrow();
  });

  it('throws SfError above upper boundary (100_001)', () => {
    assertSfError(() => validateMaxHunkLinesRange(100_001), 'InvalidMaxHunkLines', '100,000');
  });

  it('throws SfError for non-integer (1.5)', () => {
    assertSfError(() => validateMaxHunkLinesRange(1.5), 'InvalidMaxHunkLines', '--max-hunk-lines must be an integer');
  });
});

describe('getValidatedCommitMessageRegexLists', () => {
  it('returns empty lists for empty flags', () => {
    expect(getValidatedCommitMessageRegexLists({})).toEqual({ include: [], exclude: [] });
  });

  it('trims and returns include patterns', () => {
    const result = getValidatedCommitMessageRegexLists({ 'commit-message-include': ['  feat  ', 'fix'] });
    expect(result.include).toEqual(['feat', 'fix']);
  });

  it('trims and returns exclude patterns', () => {
    const result = getValidatedCommitMessageRegexLists({ 'commit-message-exclude': ['  chore  ', 'docs'] });
    expect(result.exclude).toEqual(['chore', 'docs']);
  });

  it('filters out whitespace-only include patterns', () => {
    const result = getValidatedCommitMessageRegexLists({ 'commit-message-include': ['  ', 'feat'] });
    expect(result.include).toEqual(['feat']);
  });

  it('filters out whitespace-only exclude patterns', () => {
    const result = getValidatedCommitMessageRegexLists({ 'commit-message-exclude': ['  ', 'chore'] });
    expect(result.exclude).toEqual(['chore']);
  });

  it('deduplicates include patterns', () => {
    const result = getValidatedCommitMessageRegexLists({ 'commit-message-include': ['feat', 'feat', 'fix'] });
    expect(result.include).toEqual(['feat', 'fix']);
  });

  it('throws SfError for invalid include regex', () => {
    assertSfError(
      () => getValidatedCommitMessageRegexLists({ 'commit-message-include': ['[invalid'] }),
      'InvalidMessageInclude',
      'Invalid commit message include regular expression',
    );
  });

  it('throws SfError for invalid exclude regex', () => {
    assertSfError(
      () => getValidatedCommitMessageRegexLists({ 'commit-message-exclude': ['[invalid'] }),
      'InvalidMessageExclude',
      'Invalid commit message exclude regular expression',
    );
  });
});

describe('throwIfNoCommitsAfterMessageFilter', () => {
  const commit = { hash: 'abc', message: 'feat: thing' };

  it('does not throw when original commits list is empty', () => {
    expect(() => throwIfNoCommitsAfterMessageFilter([], [], ['pattern'], [], 'error message')).not.toThrow();
  });

  it('does not throw when filtered commits is non-empty', () => {
    expect(() =>
      throwIfNoCommitsAfterMessageFilter([commit], [commit], ['pattern'], [], 'error message'),
    ).not.toThrow();
  });

  it('does not throw when no filters were applied', () => {
    expect(() => throwIfNoCommitsAfterMessageFilter([commit], [], [], [], 'error message')).not.toThrow();
  });

  it('throws SfError with provided message when filtered result is empty due to include filter', () => {
    assertSfError(
      () => throwIfNoCommitsAfterMessageFilter([commit], [], ['pattern'], [], 'no commits after filter'),
      'NoCommitsAfterFilter',
      'no commits after filter',
    );
  });

  it('throws SfError when filtered result is empty due to exclude filter', () => {
    assertSfError(
      () => throwIfNoCommitsAfterMessageFilter([commit], [], [], ['chore'], 'no commits after filter'),
      'NoCommitsAfterFilter',
      'no commits after filter',
    );
  });

  it('throws SfError when filtered result is empty due to both include and exclude filters', () => {
    assertSfError(
      () => throwIfNoCommitsAfterMessageFilter([commit], [], ['feat'], ['chore'], 'no commits after filter'),
      'NoCommitsAfterFilter',
      'no commits after filter',
    );
  });
});

describe('validateCommitMessageRegexes', () => {
  it('does not throw for a valid include regex', () => {
    expect(() => validateCommitMessageRegexes(['feat.*'], 'include')).not.toThrow();
  });

  it('throws SfError for an invalid include regex', () => {
    assertSfError(
      () => validateCommitMessageRegexes(['[invalid'], 'include'),
      'InvalidMessageInclude',
      'Invalid commit message include regular expression',
    );
  });

  it('does not throw for a valid exclude regex', () => {
    expect(() => validateCommitMessageRegexes(['chore.*'], 'exclude')).not.toThrow();
  });

  it('throws SfError for an invalid exclude regex', () => {
    assertSfError(
      () => validateCommitMessageRegexes(['[invalid'], 'exclude'),
      'InvalidMessageExclude',
      'Invalid commit message exclude regular expression',
    );
  });

  it('rethrows errors from filterCommitsByMessageRegexes that do not match the needle', () => {
    const unexpectedError = new Error('Some unexpected internal error');
    vi.mocked(filterCommitsByMessageRegexes).mockImplementationOnce(() => {
      throw unexpectedError;
    });
    expect(() => validateCommitMessageRegexes(['some-pattern'], 'include')).toThrow(unexpectedError);
  });

  it('rethrows non-Error throws from filterCommitsByMessageRegexes', () => {
    vi.mocked(filterCommitsByMessageRegexes).mockImplementationOnce(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'a plain string error';
    });
    expect(() => validateCommitMessageRegexes(['some-pattern'], 'include')).toThrow('a plain string error');
  });

  it('rethrows errors from filterCommitsByMessageRegexes for kind exclude that do not match the needle', () => {
    const unexpectedError = new Error('Some unexpected internal error');
    vi.mocked(filterCommitsByMessageRegexes).mockImplementationOnce(() => {
      throw unexpectedError;
    });
    expect(() => validateCommitMessageRegexes(['some-pattern'], 'exclude')).toThrow(unexpectedError);
  });
});

describe('mergeUniqueStrings', () => {
  it('returns empty array for empty input', () => {
    expect(mergeUniqueStrings([])).toEqual([]);
  });

  it('deduplicates strings within a single group', () => {
    expect(mergeUniqueStrings(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('merges multiple groups and deduplicates across them', () => {
    expect(mergeUniqueStrings(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('preserves order of first occurrence', () => {
    expect(mergeUniqueStrings(['c', 'a'], ['a', 'b'])).toEqual(['c', 'a', 'b']);
  });
});

describe('mergeUniqueRepoRelativePaths', () => {
  it('returns empty array for empty input', () => {
    expect(mergeUniqueRepoRelativePaths([])).toEqual([]);
  });

  it('filters out empty paths', () => {
    expect(mergeUniqueRepoRelativePaths([''])).toEqual([]);
  });

  it('strips leading slashes', () => {
    expect(mergeUniqueRepoRelativePaths(['/force-app'])).toEqual(['force-app']);
  });

  it('deduplicates normalized paths', () => {
    expect(mergeUniqueRepoRelativePaths(['force-app', '/force-app'])).toEqual(['force-app']);
  });

  it('merges and deduplicates across groups', () => {
    expect(mergeUniqueRepoRelativePaths(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('normalizes backslashes', () => {
    expect(mergeUniqueRepoRelativePaths(['sub\\dir'])).toEqual(['sub/dir']);
  });
});

describe('resolveIncludeFoldersAndExclude', () => {
  const fakeGit = {} as GitClient;
  const mockGetFolders = vi.mocked(getSalesforceMetadataIncludeFolders);

  beforeEach(() => {
    mockGetFolders.mockResolvedValue([]);
  });

  it('calls getSalesforceMetadataIncludeFolders with undefined excludes when none provided', async () => {
    mockGetFolders.mockResolvedValue(['force-app']);
    const result = await resolveIncludeFoldersAndExclude(fakeGit, {});
    expect(mockGetFolders).toHaveBeenCalledWith(fakeGit, undefined);
    expect(result).toEqual({ includeFolders: ['force-app'], excludePackageDirectories: [] });
  });

  it('passes normalized exclude dirs to getSalesforceMetadataIncludeFolders', async () => {
    mockGetFolders.mockResolvedValue(['force-app']);
    const result = await resolveIncludeFoldersAndExclude(fakeGit, { 'exclude-package-directory': ['unpackaged'] });
    expect(mockGetFolders).toHaveBeenCalledWith(fakeGit, ['unpackaged']);
    expect(result).toEqual({ includeFolders: ['force-app'], excludePackageDirectories: ['unpackaged'] });
  });

  it('merges CLI include dirs with project dirs, deduplicating', async () => {
    mockGetFolders.mockResolvedValue(['force-app']);
    const result = await resolveIncludeFoldersAndExclude(fakeGit, {
      'include-package-directory': ['extra-app', 'force-app'],
    });
    expect(result).toEqual({ includeFolders: ['force-app', 'extra-app'], excludePackageDirectories: [] });
  });

  it('returns empty includeFolders when both project and CLI dirs are empty', async () => {
    mockGetFolders.mockResolvedValue([]);
    const result = await resolveIncludeFoldersAndExclude(fakeGit, {});
    expect(result).toEqual({ includeFolders: [], excludePackageDirectories: [] });
  });

  it('normalizes exclude paths and deduplicates them', async () => {
    mockGetFolders.mockResolvedValue([]);
    const result = await resolveIncludeFoldersAndExclude(fakeGit, {
      'exclude-package-directory': ['/unpackaged', 'unpackaged'],
    });
    expect(result.excludePackageDirectories).toEqual(['unpackaged']);
    expect(mockGetFolders).toHaveBeenCalledWith(fakeGit, ['unpackaged']);
  });
});
