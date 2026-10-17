import { writeFile } from 'node:fs/promises';
import { SfError } from '@salesforce/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mcarvin/smart-diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mcarvin/smart-diff')>();
  return {
    ...actual,
    isLlmProviderConfigured: vi.fn(),
    createGitClient: vi.fn(),
    getCommits: vi.fn(),
    getMergeBase: vi.fn(),
    filterCommitsByMessageRegexes: vi.fn(),
    summarizeGitDiff: vi.fn(),
    resolveLanguageModel: vi.fn(),
  };
});

vi.mock('../../src/ai/referenceDocs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/referenceDocs.js')>();
  return { ...actual, fetchReferenceDocs: vi.fn() };
});

vi.mock('../../src/salesforce/releaseNotes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/salesforce/releaseNotes.js')>();
  return { ...actual, fetchReleaseNotes: vi.fn(), readSourceApiVersionAt: vi.fn() };
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
  createGitClient,
  filterCommitsByMessageRegexes,
  getCommits,
  getMergeBase,
  isLlmProviderConfigured,
  resolveLanguageModel,
  summarizeGitDiff,
} from '@mcarvin/smart-diff';
import { fetchReferenceDocs, MAX_REFERENCE_CHARS, REFERENCE_DOCS_SYSTEM_SUFFIX } from '../../src/ai/referenceDocs.js';
import { runMetadataSummarize, type SummarizeOptions } from '../../src/metadata/summarizeCore.js';
import {
  fetchReleaseNotes,
  readSourceApiVersionAt,
  salesforceReleaseForApiVersion,
} from '../../src/salesforce/releaseNotes.js';
import { getSalesforceMetadataIncludeFolders } from '../../src/salesforce/sfdxPackagePaths.js';

const COMMIT = { hash: 'abc123', message: 'feat: thing' };

const USAGE = { requestCount: 1, inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 0 };

const MINIMAL_OPTIONS: SummarizeOptions = {
  from: 'abc123',
  'merge-base': false,
  output: 'summary.md',
  'ignore-whitespace': false,
  'strip-diff-preamble': false,
  'exclude-default-noise': false,
  'map-reduce': false,
  'redact-secrets': false,
};

const FULL_OPTIONS: SummarizeOptions = {
  from: 'abc123',
  'merge-base': false,
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
  'map-reduce': true,
  'redact-secrets': true,
  'max-retries': 4,
};

describe('runMetadataSummarize', () => {
  beforeEach(() => {
    vi.mocked(isLlmProviderConfigured).mockReturnValue(true);
    vi.mocked(createGitClient).mockReturnValue({} as ReturnType<typeof createGitClient>);
    vi.mocked(getSalesforceMetadataIncludeFolders).mockResolvedValue(['force-app']);
    vi.mocked(getCommits).mockResolvedValue([COMMIT]);
    vi.mocked(filterCommitsByMessageRegexes).mockReturnValue([COMMIT]);
    vi.mocked(summarizeGitDiff).mockResolvedValue({ summary: '## Summary', usage: USAGE });
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('returns path and calls log on success with minimal options (to defaults to HEAD)', async () => {
    const log = vi.fn();
    const result = await runMetadataSummarize(MINIMAL_OPTIONS, 'no package dirs', () => 'no commits', log);
    expect(result).toEqual({ path: 'summary.md', usage: USAGE, references: [] });
    expect(log).toHaveBeenCalledWith('Generated metadata summary at summary.md');
    expect(writeFile).toHaveBeenCalledWith('summary.md', '## Summary', 'utf8');
    expect(getCommits).toHaveBeenCalledWith(expect.anything(), 'abc123', 'HEAD');
    expect(filterCommitsByMessageRegexes).toHaveBeenCalledWith([COMMIT], undefined, undefined);
    expect(summarizeGitDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'abc123',
        mergeBase: undefined,
        to: undefined,
        excludeFolders: undefined,
        commitMessageIncludeRegexes: undefined,
        commitMessageExcludeRegexes: undefined,
        ignoreWhitespace: undefined,
        stripDiffPreamble: undefined,
        excludeDefaultNoise: undefined,
        mapReduce: undefined,
        redactSecrets: undefined,
        maxRetries: undefined,
        teamName: undefined,
      }),
    );
  });

  it('passes all optional flags through to summarizeGitDiffWithUsage when set', async () => {
    const log = vi.fn();
    const result = await runMetadataSummarize(FULL_OPTIONS, 'no package dirs', () => 'no commits', log);
    expect(result).toEqual({ path: 'out.md', usage: USAGE, references: [] });
    expect(getCommits).toHaveBeenCalledWith(expect.anything(), 'abc123', 'def456');
    expect(filterCommitsByMessageRegexes).toHaveBeenCalledWith([COMMIT], ['feat'], ['chore']);
    expect(summarizeGitDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'abc123',
        mergeBase: undefined,
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
        mapReduce: true,
        redactSecrets: true,
        maxRetries: 4,
        teamName: 'Platform',
      }),
    );
  });

  it('throws SfError when LLM provider is not configured', async () => {
    vi.mocked(isLlmProviderConfigured).mockReturnValue(false);
    let caught: unknown;
    try {
      await runMetadataSummarize(MINIMAL_OPTIONS, 'no pkg dirs', () => 'no commits', vi.fn());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SfError);
    expect((caught as SfError).name).toBe('NoLlmProvider');
  });

  it('throws SfError when max-diff-chars is below valid range', async () => {
    await expect(
      runMetadataSummarize({ ...MINIMAL_OPTIONS, 'max-diff-chars': 100 }, 'no pkg dirs', () => 'no commits', vi.fn()),
    ).rejects.toBeInstanceOf(SfError);
  });

  it('throws SfError when context-lines is out of valid range', async () => {
    await expect(
      runMetadataSummarize({ ...MINIMAL_OPTIONS, 'context-lines': -1 }, 'no pkg dirs', () => 'no commits', vi.fn()),
    ).rejects.toBeInstanceOf(SfError);
  });

  it('throws SfError when max-hunk-lines is below valid range', async () => {
    await expect(
      runMetadataSummarize({ ...MINIMAL_OPTIONS, 'max-hunk-lines': 0 }, 'no pkg dirs', () => 'no commits', vi.fn()),
    ).rejects.toBeInstanceOf(SfError);
  });

  it('throws SfError when max-retries is negative', async () => {
    await expect(
      runMetadataSummarize({ ...MINIMAL_OPTIONS, 'max-retries': -1 }, 'no pkg dirs', () => 'no commits', vi.fn()),
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

  it('resolves from locally via getMergeBase for commit filtering when merge-base is set, but passes raw from/mergeBase to summarizeGitDiff', async () => {
    vi.mocked(getMergeBase).mockResolvedValue('merge-base-sha');
    const log = vi.fn();
    const options: SummarizeOptions = {
      from: 'main',
      'merge-base': true,
      output: 'summary.md',
      to: 'develop',
      'ignore-whitespace': false,
      'strip-diff-preamble': false,
      'exclude-default-noise': false,
      'map-reduce': false,
      'redact-secrets': false,
    };

    const result = await runMetadataSummarize(options, 'no package dirs', () => 'no commits', log);

    expect(result).toEqual({ path: 'summary.md', usage: USAGE, references: [] });
    expect(getMergeBase).toHaveBeenCalledWith(expect.anything(), 'develop', 'main');
    expect(getCommits).toHaveBeenCalledWith(expect.anything(), 'merge-base-sha', 'develop');
    expect(summarizeGitDiff).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'main', mergeBase: true, to: 'develop' }),
    );
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

  describe('reference documentation', () => {
    const DOC_A = { url: 'https://example.com/a', excerpts: 'Docs A', truncated: false };
    const DOC_B = { url: 'https://example.com/b', excerpts: 'Docs B', truncated: true };
    const generate = vi.fn(async () => ({ text: 'ok', usage: {} }));

    beforeEach(() => {
      vi.mocked(resolveLanguageModel).mockResolvedValue({ generate });
      vi.mocked(fetchReferenceDocs).mockResolvedValue([]);
      vi.mocked(fetchReleaseNotes).mockResolvedValue([]);
      vi.mocked(readSourceApiVersionAt).mockResolvedValue(undefined);
    });

    async function wrappedSystemPrompt(): Promise<string> {
      const { llmModelProvider } = vi.mocked(summarizeGitDiff).mock.calls[0][0];
      const model = await llmModelProvider?.();
      await model?.generate({ system: 'S', prompt: 'P', temperature: 0, maxOutputTokens: 1 });
      return (generate.mock.calls[0] as unknown as [{ system: string }])[0].system;
    }

    it('does not touch Parallel or wrap the model when no references are requested', async () => {
      const result = await runMetadataSummarize(MINIMAL_OPTIONS, 'x', () => 'y', vi.fn());
      expect(result.references).toEqual([]);
      expect(fetchReferenceDocs).not.toHaveBeenCalled();
      expect(readSourceApiVersionAt).not.toHaveBeenCalled();
      expect(resolveLanguageModel).not.toHaveBeenCalled();
      expect(vi.mocked(summarizeGitDiff).mock.calls[0][0]).not.toHaveProperty('llmModelProvider');
    });

    it('validates reference URLs before any git work', async () => {
      await expect(
        runMetadataSummarize({ ...MINIMAL_OPTIONS, 'reference-url': ['http://insecure'] }, 'x', () => 'y', vi.fn()),
      ).rejects.toThrow('--reference-url must be a public HTTPS URL');
      expect(createGitClient).not.toHaveBeenCalled();
    });

    it('fetches explicit URLs, wraps the model with --model, logs, and returns references', async () => {
      vi.mocked(fetchReferenceDocs).mockResolvedValue([DOC_A, DOC_B]);
      const log = vi.fn();

      const result = await runMetadataSummarize(
        { ...MINIMAL_OPTIONS, model: 'my-model', 'reference-url': [DOC_A.url, DOC_B.url] },
        'x',
        () => 'y',
        log,
      );

      expect(fetchReferenceDocs).toHaveBeenCalledWith([DOC_A.url, DOC_B.url], { charBudget: MAX_REFERENCE_CHARS });
      expect(resolveLanguageModel).toHaveBeenCalledWith({ model: 'my-model' });
      expect(result.references).toEqual([DOC_A.url, DOC_B.url]);
      expect(log).toHaveBeenCalledWith('Added reference documentation: https://example.com/a');
      expect(log).toHaveBeenCalledWith('Added reference documentation: https://example.com/b (excerpts truncated)');
      expect(await wrappedSystemPrompt()).toBe(`S\n${REFERENCE_DOCS_SYSTEM_SUFFIX}`);
    });

    it('resolves the default model when --model is not set', async () => {
      vi.mocked(fetchReferenceDocs).mockResolvedValue([DOC_A]);
      await runMetadataSummarize({ ...MINIMAL_OPTIONS, 'reference-url': [DOC_A.url] }, 'x', () => 'y', vi.fn());
      expect(resolveLanguageModel).toHaveBeenCalledWith({});
    });

    it('stops before the LLM when an explicit URL cannot be retrieved', async () => {
      vi.mocked(fetchReferenceDocs).mockRejectedValue(new Error('retrieval failed'));
      await expect(
        runMetadataSummarize({ ...MINIMAL_OPTIONS, 'reference-url': [DOC_A.url] }, 'x', () => 'y', vi.fn()),
      ).rejects.toThrow('retrieval failed');
      expect(summarizeGitDiff).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('adds release notes for upgraded API versions and shares the budget with explicit URLs', async () => {
      vi.mocked(readSourceApiVersionAt).mockImplementation(async (_git, rev) => (rev === 'def456' ? 65 : 63));
      vi.mocked(fetchReferenceDocs).mockResolvedValue([DOC_A]);
      vi.mocked(fetchReleaseNotes).mockImplementation(async (release) =>
        release.apiVersion === 64 ? [DOC_A, { ...DOC_B, url: 'https://help.salesforce.com/64' }] : [],
      );
      const log = vi.fn();

      const result = await runMetadataSummarize(
        { ...MINIMAL_OPTIONS, to: 'def456', 'release-notes': true, 'reference-url': [DOC_A.url] },
        'x',
        () => 'y',
        log,
      );

      expect(readSourceApiVersionAt).toHaveBeenCalledWith(expect.anything(), 'def456');
      expect(readSourceApiVersionAt).toHaveBeenCalledWith(expect.anything(), 'abc123');
      const budget = Math.floor(MAX_REFERENCE_CHARS / 3);
      expect(fetchReferenceDocs).toHaveBeenCalledWith([DOC_A.url], { charBudget: budget });
      expect(fetchReleaseNotes).toHaveBeenCalledWith(salesforceReleaseForApiVersion(64), { charBudget: budget });
      expect(fetchReleaseNotes).toHaveBeenCalledWith(salesforceReleaseForApiVersion(65), { charBudget: budget });
      expect(result.references).toEqual([DOC_A.url, 'https://help.salesforce.com/64']);
      expect(log).toHaveBeenCalledWith(
        "Warning: no usable Salesforce Winter '26 release notes were retrieved; continuing without them.",
      );
    });

    it('uses the merge-base commit as the from revision for release notes', async () => {
      vi.mocked(getMergeBase).mockResolvedValue('merge-base-sha');
      vi.mocked(readSourceApiVersionAt).mockResolvedValue(64);
      await runMetadataSummarize(
        { ...MINIMAL_OPTIONS, 'merge-base': true, 'release-notes': true },
        'x',
        () => 'y',
        vi.fn(),
      );
      expect(readSourceApiVersionAt).toHaveBeenCalledWith(expect.anything(), 'HEAD');
      expect(readSourceApiVersionAt).toHaveBeenCalledWith(expect.anything(), 'merge-base-sha');
      expect(fetchReleaseNotes).toHaveBeenCalledWith(salesforceReleaseForApiVersion(64), {
        charBudget: MAX_REFERENCE_CHARS,
      });
    });

    it('skips release notes with a warning when sourceApiVersion is missing', async () => {
      const log = vi.fn();
      const result = await runMetadataSummarize({ ...MINIMAL_OPTIONS, 'release-notes': true }, 'x', () => 'y', log);
      expect(log).toHaveBeenCalledWith(
        'Warning: no sourceApiVersion found in sfdx-project.json at HEAD; skipping release notes.',
      );
      expect(fetchReleaseNotes).not.toHaveBeenCalled();
      expect(fetchReferenceDocs).not.toHaveBeenCalled();
      expect(resolveLanguageModel).not.toHaveBeenCalled();
      expect(result.references).toEqual([]);
    });

    it('generates without a wrapped model when no release notes were usable', async () => {
      vi.mocked(readSourceApiVersionAt).mockResolvedValue(64);
      const result = await runMetadataSummarize({ ...MINIMAL_OPTIONS, 'release-notes': true }, 'x', () => 'y', vi.fn());
      expect(result.references).toEqual([]);
      expect(vi.mocked(summarizeGitDiff).mock.calls[0][0]).not.toHaveProperty('llmModelProvider');
    });
  });
});
