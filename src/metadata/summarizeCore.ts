import { writeFile } from 'node:fs/promises';
import {
  createGitClient,
  filterCommitsByMessageRegexes,
  getCommits,
  getMergeBase,
  isLlmProviderConfigured,
  LLM_GATEWAY_REQUIRED_MESSAGE,
  type LlmModelProvider,
  type LlmUsageReport,
  resolveLanguageModel,
  summarizeGitDiff,
} from '@mcarvin/smart-diff';
import { SfError } from '@salesforce/core';

import {
  buildReferenceDocsModelProvider,
  fetchReferenceDocs,
  MAX_REFERENCE_CHARS,
  type ReferenceDoc,
  validateReferenceUrls,
} from '../ai/referenceDocs.js';
import { SALESFORCE_METADATA_SYSTEM_PROMPT } from '../ai/salesforceMetadataPrompt.js';
import { resolveMetadataSummaryTeam } from '../salesforce/metadataSummaryContext.js';
import {
  fetchReleaseNotes,
  readSourceApiVersionAt,
  releaseNoteApiVersions,
  salesforceReleaseForApiVersion,
} from '../salesforce/releaseNotes.js';
import type { GitClient } from '../salesforce/sfdxPackagePaths.js';
import {
  getValidatedCommitMessageRegexLists,
  resolveIncludeFoldersAndExclude,
  throwIfNoCommitsAfterMessageFilter,
  validateContextLinesRange,
  validateMaxDiffCharsRange,
  validateMaxHunkLinesRange,
  validateMaxRetriesRange,
} from './summarizeHelpers.js';

export type SummarizeOptions = {
  from: string;
  'merge-base': boolean;
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
  'map-reduce': boolean;
  'redact-secrets': boolean;
  'max-retries'?: number;
  'reference-url'?: string[];
  'release-notes'?: boolean;
};

export type SummarizeResult = { path: string; usage: LlmUsageReport; references: string[] };

export async function runMetadataSummarize(
  options: SummarizeOptions,
  noPackageDirectoriesError: string,
  noCommitsAfterFilterError: (from: string, to: string, include: string, exclude: string) => string,
  log: (message: string) => void,
): Promise<SummarizeResult> {
  validateMaxDiffCharsRange(options['max-diff-chars']);
  validateContextLinesRange(options['context-lines']);
  validateMaxHunkLinesRange(options['max-hunk-lines']);
  validateMaxRetriesRange(options['max-retries']);
  const referenceUrls = validateReferenceUrls(options['reference-url']);

  if (!isLlmProviderConfigured()) {
    throw new SfError(LLM_GATEWAY_REQUIRED_MESSAGE, 'NoLlmProvider');
  }

  const to = options.to ?? 'HEAD';
  const { include: commitMessageIncludeRegexes, exclude: commitMessageExcludeFromFlag } =
    getValidatedCommitMessageRegexLists(options);

  const git = await createGitClient(process.cwd());
  const from = options['merge-base'] ? await getMergeBase(git, to, options.from) : options.from;

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

  const referenceDocs = await collectReferenceDocs(
    git,
    from,
    to,
    referenceUrls,
    options['release-notes'] === true,
    log,
  );
  const llmModelProvider = await resolveReferenceModelProvider(referenceDocs, options.model);

  const { summary, usage } = await summarizeGitDiff({
    from: options.from,
    mergeBase: options['merge-base'] || undefined,
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
    mapReduce: options['map-reduce'] || undefined,
    redactSecrets: options['redact-secrets'] || undefined,
    maxRetries: options['max-retries'],
    ...(llmModelProvider ? { llmModelProvider } : {}),
  });

  await writeFile(options.output, summary, 'utf8');
  log(`Generated metadata summary at ${options.output}`);

  return { path: options.output, usage, references: referenceDocs.map((doc) => doc.url) };
}

async function collectReferenceDocs(
  git: GitClient,
  from: string,
  to: string,
  referenceUrls: string[],
  releaseNotes: boolean,
  log: (message: string) => void,
): Promise<ReferenceDoc[]> {
  const releases = releaseNotes ? await resolveReleases(git, from, to, log) : [];
  const sourceCount = referenceUrls.length + releases.length;
  if (sourceCount === 0) return [];
  const charBudget = Math.floor(MAX_REFERENCE_CHARS / sourceCount);

  // Explicit URLs are required context: any retrieval failure stops before the LLM is called.
  const docs = await fetchReferenceDocs(referenceUrls, { charBudget: charBudget * referenceUrls.length });
  for (const release of releases) {
    const found = await fetchReleaseNotes(release, { charBudget });
    if (found.length === 0) {
      log(`Warning: no usable Salesforce ${release.name} release notes were retrieved; continuing without them.`);
    }
    docs.push(...found.filter((doc) => !docs.some((existing) => existing.url === doc.url)));
  }
  for (const doc of docs) {
    log(`Added reference documentation: ${doc.url}${doc.truncated ? ' (excerpts truncated)' : ''}`);
  }
  return docs;
}

async function resolveReleases(
  git: GitClient,
  from: string,
  to: string,
  log: (message: string) => void,
): Promise<ReturnType<typeof salesforceReleaseForApiVersion>[]> {
  const toVersion = await readSourceApiVersionAt(git, to);
  if (toVersion === undefined) {
    log(`Warning: no sourceApiVersion found in sfdx-project.json at ${to}; skipping release notes.`);
    return [];
  }
  const fromVersion = await readSourceApiVersionAt(git, from);
  return releaseNoteApiVersions(fromVersion, toVersion).map(salesforceReleaseForApiVersion);
}

async function resolveReferenceModelProvider(
  docs: ReferenceDoc[],
  model: string | undefined,
): Promise<LlmModelProvider | undefined> {
  if (docs.length === 0) return undefined;
  // A custom provider bypasses smart-diff's own model resolution, so honor --model here.
  return buildReferenceDocsModelProvider(await resolveLanguageModel(model ? { model } : {}), docs);
}
