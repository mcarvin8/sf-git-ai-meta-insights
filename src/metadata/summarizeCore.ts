import { writeFile } from 'node:fs/promises';
import { SfError } from '@salesforce/core';
import {
  createGitClient,
  filterCommitsByMessageRegexes,
  getCommits,
  isLlmProviderConfigured,
  LLM_GATEWAY_REQUIRED_MESSAGE,
  summarizeGitDiff,
} from '@mcarvin/smart-diff';

import { SALESFORCE_METADATA_SYSTEM_PROMPT } from '../ai/salesforceMetadataPrompt.js';
import { resolveMetadataSummaryTeam } from '../salesforce/metadataSummaryContext.js';
import {
  getValidatedCommitMessageRegexLists,
  resolveIncludeFoldersAndExclude,
  throwIfNoCommitsAfterMessageFilter,
  validateContextLinesRange,
  validateMaxDiffCharsRange,
  validateMaxHunkLinesRange,
} from './summarizeHelpers.js';

export type SummarizeOptions = {
  from: string;
  to?: string;
  'commit-message-include'?: string[];
  'commit-message-exclude'?: string[];
  'include-package-directory'?: string[];
  'exclude-package-directory'?: string[];
  team?: string;
  output: string;
  model?: string;
  'max-diff-chars'?: number;
  'context-lines'?: number;
  'ignore-whitespace': boolean;
  'strip-diff-preamble': boolean;
  'max-hunk-lines'?: number;
  'exclude-default-noise': boolean;
};

export async function runMetadataSummarize(
  options: SummarizeOptions,
  noPackageDirectoriesError: string,
  noCommitsAfterFilterError: (from: string, to: string, include: string, exclude: string) => string,
  log: (message: string) => void,
): Promise<{ path: string }> {
  validateMaxDiffCharsRange(options['max-diff-chars']);
  validateContextLinesRange(options['context-lines']);
  validateMaxHunkLinesRange(options['max-hunk-lines']);

  if (!isLlmProviderConfigured()) {
    throw new SfError(LLM_GATEWAY_REQUIRED_MESSAGE, 'NoLlmProvider');
  }

  const from = options.from;
  const to = options.to ?? 'HEAD';
  const { include: commitMessageIncludeRegexes, exclude: commitMessageExcludeFromFlag } =
    getValidatedCommitMessageRegexLists(options);

  const git = createGitClient(process.cwd());
  const { includeFolders, excludePackageDirectories } = await resolveIncludeFoldersAndExclude(git, options);

  if (includeFolders.length === 0) {
    throw new SfError(noPackageDirectoriesError, 'NoPackageDirectories');
  }

  const commits = await getCommits(git, from, to);
  const filteredCommits = filterCommitsByMessageRegexes(
    commits,
    commitMessageIncludeRegexes.length > 0 ? commitMessageIncludeRegexes : undefined,
    commitMessageExcludeFromFlag.length > 0 ? commitMessageExcludeFromFlag : undefined,
  );

  throwIfNoCommitsAfterMessageFilter(
    commits,
    filteredCommits,
    commitMessageIncludeRegexes,
    commitMessageExcludeFromFlag,
    noCommitsAfterFilterError(
      from,
      to,
      JSON.stringify(commitMessageIncludeRegexes),
      JSON.stringify(commitMessageExcludeFromFlag),
    ),
  );

  const teamName = resolveMetadataSummaryTeam(options.team);

  const summary = await summarizeGitDiff({
    from,
    to: options.to,
    git,
    cwd: process.cwd(),
    includeFolders,
    excludeFolders: excludePackageDirectories.length > 0 ? excludePackageDirectories : undefined,
    systemPrompt: SALESFORCE_METADATA_SYSTEM_PROMPT,
    teamName,
    model: options.model,
    maxDiffChars: options['max-diff-chars'],
    commitMessageIncludeRegexes: commitMessageIncludeRegexes.length > 0 ? commitMessageIncludeRegexes : undefined,
    commitMessageExcludeRegexes: commitMessageExcludeFromFlag.length > 0 ? commitMessageExcludeFromFlag : undefined,
    contextLines: options['context-lines'],
    ignoreWhitespace: options['ignore-whitespace'] || undefined,
    stripDiffPreamble: options['strip-diff-preamble'] || undefined,
    maxHunkLines: options['max-hunk-lines'],
    excludeDefaultNoise: options['exclude-default-noise'] || undefined,
  });

  await writeFile(options.output, summary, 'utf8');
  log(`Generated metadata summary at ${options.output}`);

  return { path: options.output };
}
