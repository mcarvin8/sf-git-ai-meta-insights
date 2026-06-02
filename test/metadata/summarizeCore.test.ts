import { writeFile } from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SfError } from '@salesforce/core';

vi.mock('@mcarvin/smart-diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mcarvin/smart-diff')>();
  return {
    ...actual,
    isLlmProviderConfigured: vi.fn(),
    createGitClient: vi.fn(),
    getCommits: vi.fn(),
    filterCommitsByMessageRegexes: vi.fn(),
    summarizeGitDiff: vi.fn(),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn() };
});

vi.mock('../../src/salesforce/sfdxPackagePaths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/salesforce/sfdxPackagePaths.js')>();
  return { ...actual, getSalesforceMetadataIncludeFolders: vi.fn() };
});

import {
  isLlmProviderConfigured,
  createGitClient,
  getCommits,
  filterCommitsByMessageRegexes,
  summarizeGitDiff,
} from '@mcarvin/smart-diff';
import { getSalesforceMetadataIncludeFolders } from '../../src/salesforce/sfdxPackagePaths.js';
import { runMetadataSummarize, type SummarizeOptions } from '../../src/metadata/summarizeCore.js';

const COMMIT = { hash: 'abc123', message: 'feat: thing' };

const MINIMAL_OPTIONS: SummarizeOptions = {
  from: 'abc123',
  output: 'summary.md',
  'ignore-whitespace': false,
  'strip-diff-preamble': false,
  'exclude-default-noise': false,
};

const FULL_OPTIONS: SummarizeOptions = {
  from: 'abc123',
  to: 'def456',
  'commit-message-include': ['feat'],
  'commit-message-exclude': ['chore'],
  'include-package-directory': ['extra-app'],
  'exclude-package-directory': ['unpackaged'],
  team: 'Platform',
  output: 'out.md',
  model: 'claude-opus',
  'max-diff-chars': 10_000,
  'context-lines': 5,
  'ignore-whitespace': true,
  'strip-diff-preamble': true,
  'max-hunk-lines': 500,
  'exclude-default-noise': true,
};

describe('runMetadataSummarize', () => {
  beforeEach(() => {
    vi.mocked(isLlmProviderConfigured).mockReturnValue(true);
    vi.mocked(createGitClient).mockReturnValue({} as ReturnType<typeof createGitClient>);
    vi.mocked(getSalesforceMetadataIncludeFolders).mockResolvedValue(['force-app']);
    vi.mocked(getCommits).mockResolvedValue([COMMIT]);
    vi.mocked(filterCommitsByMessageRegexes).mockReturnValue([COMMIT]);
    vi.mocked(summarizeGitDiff).mockResolvedValue('## Summary');
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('returns path and calls log on success with minimal options (to defaults to HEAD)', async () => {
    const log = vi.fn();
    const result = await runMetadataSummarize(MINIMAL_OPTIONS, 'no package dirs', () => 'no commits', log);
    expect(result).toEqual({ path: 'summary.md' });
    expect(log).toHaveBeenCalledWith('Generated metadata summary at summary.md');
    expect(writeFile).toHaveBeenCalledWith('summary.md', '## Summary', 'utf8');
    expect(getCommits).toHaveBeenCalledWith(expect.anything(), 'abc123', 'HEAD');
    expect(filterCommitsByMessageRegexes).toHaveBeenCalledWith([COMMIT], undefined, undefined);
    expect(summarizeGitDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'abc123',
        to: undefined,
        excludeFolders: undefined,
        commitMessageIncludeRegexes: undefined,
        commitMessageExcludeRegexes: undefined,
        ignoreWhitespace: undefined,
        stripDiffPreamble: undefined,
        excludeDefaultNoise: undefined,
        teamName: undefined,
      }),
    );
  });

  it('passes all optional flags through to summarizeGitDiff when set', async () => {
    const log = vi.fn();
    const result = await runMetadataSummarize(FULL_OPTIONS, 'no package dirs', () => 'no commits', log);
    expect(result).toEqual({ path: 'out.md' });
    expect(getCommits).toHaveBeenCalledWith(expect.anything(), 'abc123', 'def456');
    expect(filterCommitsByMessageRegexes).toHaveBeenCalledWith([COMMIT], ['feat'], ['chore']);
    expect(summarizeGitDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'abc123',
        to: 'def456',
        excludeFolders: ['unpackaged'],
        commitMessageIncludeRegexes: ['feat'],
        commitMessageExcludeRegexes: ['chore'],
        ignoreWhitespace: true,
        stripDiffPreamble: true,
        excludeDefaultNoise: true,
        maxDiffChars: 10_000,
        contextLines: 5,
        maxHunkLines: 500,
        teamName: 'Platform',
      }),
    );
  });

  it('throws SfError when LLM provider is not configured', async () => {
    vi.mocked(isLlmProviderConfigured).mockReturnValue(false);
    await expect(
      runMetadataSummarize(MINIMAL_OPTIONS, 'no pkg dirs', () => 'no commits', vi.fn()),
    ).rejects.toBeInstanceOf(SfError);
  });

  it('throws with noPackageDirectoriesError message when no include folders resolved', async () => {
    vi.mocked(getSalesforceMetadataIncludeFolders).mockResolvedValue([]);
    let caught: unknown;
    try {
      await runMetadataSummarize(MINIMAL_OPTIONS, 'no package directories!', () => 'no commits', vi.fn());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SfError);
    expect((caught as SfError).message).toBe('no package directories!');
    expect((caught as SfError).name).toBe('NoPackageDirectories');
  });

  it('calls noCommitsAfterFilterError with correct args and throws when commits filter to zero', async () => {
    vi.mocked(filterCommitsByMessageRegexes).mockReturnValue([]);
    const noCommitsAfterFilterError = vi.fn(() => 'filtered to zero');
    await expect(
      runMetadataSummarize(
        { ...MINIMAL_OPTIONS, 'commit-message-include': ['feat'] },
        'no pkg dirs',
        noCommitsAfterFilterError,
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(SfError);
    expect(noCommitsAfterFilterError).toHaveBeenCalledWith('abc123', 'HEAD', '["feat"]', '[]');
  });
});
