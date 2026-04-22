import { writeFile } from 'node:fs/promises';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import type { CommitInfo } from '@mcarvin/smart-diff';
import {
  createGitClient,
  filterCommitsByMessageRegexes,
  getCommits,
  isLlmProviderConfigured,
  LLM_GATEWAY_REQUIRED_MESSAGE,
  summarizeGitDiff,
} from '@mcarvin/smart-diff';

import { SALESFORCE_METADATA_SYSTEM_PROMPT } from '../../../ai/salesforceMetadataPrompt.js';
import { resolveMetadataSummaryTeam } from '../../../salesforce/metadataSummaryContext.js';
import {
  type GitClient,
  getSalesforceMetadataIncludeFolders,
  normalizeRepoRelativeFolderPath,
} from '../../../salesforce/sfdxPackagePaths.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-git-ai-meta-insights', 'sgai.metadata.summarize');

function validateMaxDiffCharsRange(maxDiffChars: number | undefined): void {
  if (maxDiffChars === undefined) return;
  if (maxDiffChars < 5000 || maxDiffChars > 5_000_000) {
    throw new SfError(
      `--max-diff-chars must be between 5000 and 5,000,000 (received ${maxDiffChars}).`,
      'InvalidMaxDiffChars'
    );
  }
}

type CommitMessageRegexFlags = {
  'commit-message-include'?: string[];
  'commit-message-exclude'?: string[];
};

function getValidatedCommitMessageRegexLists(flags: CommitMessageRegexFlags): {
  include: string[];
  exclude: string[];
} {
  const include = mergeUniqueStrings(
    (flags['commit-message-include'] ?? []).map((s) => s.trim()).filter((s) => s.length > 0)
  );
  const exclude = (flags['commit-message-exclude'] ?? []).map((s) => s.trim()).filter((s) => s.length > 0);

  if (include.length > 0) {
    validateCommitMessageRegexes(include, 'include');
  }
  if (exclude.length > 0) {
    validateCommitMessageRegexes(exclude, 'exclude');
  }

  return { include, exclude };
}

type PackageDirectoryFlags = {
  'exclude-package-directory'?: string[];
  'include-package-directory'?: string[];
};

async function resolveIncludeFoldersAndExclude(
  git: GitClient,
  flags: PackageDirectoryFlags
): Promise<{ includeFolders: string[]; excludePackageDirectories: string[] }> {
  const excludePackageDirectories = mergeUniqueRepoRelativePaths(flags['exclude-package-directory'] ?? []);
  const includeFoldersFromProject = await getSalesforceMetadataIncludeFolders(
    git,
    excludePackageDirectories.length > 0 ? excludePackageDirectories : undefined
  );
  const includeFoldersFromCli = mergeUniqueRepoRelativePaths(flags['include-package-directory'] ?? []);
  const includeFolders = mergeUniqueRepoRelativePaths(includeFoldersFromProject, includeFoldersFromCli);
  return { includeFolders, excludePackageDirectories };
}

function throwIfNoCommitsAfterMessageFilter(
  commits: CommitInfo[],
  filteredCommits: CommitInfo[],
  includeRegexes: string[],
  excludeRegexes: string[],
  from: string,
  to: string
): void {
  if (commits.length > 0 && filteredCommits.length === 0 && (includeRegexes.length > 0 || excludeRegexes.length > 0)) {
    throw new SfError(
      messages.getMessage('errors.noCommitsAfterFilter', [
        from,
        to,
        JSON.stringify(includeRegexes),
        JSON.stringify(excludeRegexes),
      ]),
      'NoCommitsAfterFilter'
    );
  }
}

export type SgaiMetadataSummarizeResult = {
  path: string;
};

function validateCommitMessageRegexes(patterns: string[], kind: 'include' | 'exclude'): void {
  for (const pattern of patterns) {
    try {
      filterCommitsByMessageRegexes(
        [{ hash: '_', message: ' ' }],
        kind === 'include' ? [pattern] : undefined,
        kind === 'exclude' ? [pattern] : undefined
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needle =
        kind === 'include' ? 'Invalid commit message include pattern' : 'Invalid commit message exclude pattern';
      if (message.includes(needle)) {
        throw new SfError(
          `Invalid commit message ${kind} regular expression: ${JSON.stringify(pattern)}`,
          kind === 'include' ? 'InvalidMessageInclude' : 'InvalidMessageExclude'
        );
      }
      throw err;
    }
  }
}

function mergeUniqueStrings(...groups: string[][]): string[] {
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

function mergeUniqueRepoRelativePaths(...groups: string[][]): string[] {
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

export default class SgaiMetadataSummarize extends SfCommand<SgaiMetadataSummarizeResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    from: Flags.string({
      summary: messages.getMessage('flags.from.summary'),
      description: messages.getMessage('flags.from.description'),
      char: 'f',
      required: true,
    }),
    to: Flags.string({
      summary: messages.getMessage('flags.to.summary'),
      description: messages.getMessage('flags.to.description'),
      char: 't',
      required: false,
    }),
    'commit-message-include': Flags.string({
      summary: messages.getMessage('flags.commit-message-include.summary'),
      description: messages.getMessage('flags.commit-message-include.description'),
      char: 'm',
      required: false,
      multiple: true,
    }),
    'commit-message-exclude': Flags.string({
      summary: messages.getMessage('flags.commit-message-exclude.summary'),
      description: messages.getMessage('flags.commit-message-exclude.description'),
      char: 'e',
      required: false,
      multiple: true,
    }),
    'include-package-directory': Flags.string({
      summary: messages.getMessage('flags.include-package-directory.summary'),
      description: messages.getMessage('flags.include-package-directory.description'),
      char: 'i',
      required: false,
      multiple: true,
    }),
    'exclude-package-directory': Flags.string({
      summary: messages.getMessage('flags.exclude-package-directory.summary'),
      description: messages.getMessage('flags.exclude-package-directory.description'),
      char: 'x',
      required: false,
      multiple: true,
    }),
    team: Flags.string({
      summary: messages.getMessage('flags.team.summary'),
      description: messages.getMessage('flags.team.description'),
      required: false,
    }),
    output: Flags.string({
      summary: messages.getMessage('flags.output.summary'),
      description: messages.getMessage('flags.output.description'),
      char: 'p',
      required: false,
      default: 'metadata-summary.md',
    }),
    model: Flags.string({
      summary: messages.getMessage('flags.model.summary'),
      description: messages.getMessage('flags.model.description'),
      required: false,
    }),
    'max-diff-chars': Flags.integer({
      summary: messages.getMessage('flags.max-diff-chars.summary'),
      description: messages.getMessage('flags.max-diff-chars.description'),
      required: false,
    }),
  };

  public async run(): Promise<SgaiMetadataSummarizeResult> {
    const { flags } = await this.parse(SgaiMetadataSummarize);

    validateMaxDiffCharsRange(flags['max-diff-chars']);

    if (!isLlmProviderConfigured()) {
      throw new SfError(LLM_GATEWAY_REQUIRED_MESSAGE, 'NoLlmProvider');
    }

    const from = flags.from;
    const to = flags.to ?? 'HEAD';
    const outputPath = flags.output ?? 'metadata-summary.md';
    const { include: commitMessageIncludeRegexes, exclude: commitMessageExcludeFromFlag } =
      getValidatedCommitMessageRegexLists(flags);

    const git = createGitClient(process.cwd());
    const { includeFolders, excludePackageDirectories } = await resolveIncludeFoldersAndExclude(git, flags);

    if (includeFolders.length === 0) {
      throw new SfError(messages.getMessage('errors.noPackageDirectories'), 'NoPackageDirectories');
    }

    const commits = await getCommits(git, from, to);
    const filteredCommits = filterCommitsByMessageRegexes(
      commits,
      commitMessageIncludeRegexes.length > 0 ? commitMessageIncludeRegexes : undefined,
      commitMessageExcludeFromFlag.length > 0 ? commitMessageExcludeFromFlag : undefined
    );

    throwIfNoCommitsAfterMessageFilter(
      commits,
      filteredCommits,
      commitMessageIncludeRegexes,
      commitMessageExcludeFromFlag,
      from,
      to
    );

    const teamName = resolveMetadataSummaryTeam(flags.team);

    const maxDiffCharsFlag = flags['max-diff-chars'];

    const summary = await summarizeGitDiff({
      from,
      to: flags.to,
      git,
      cwd: process.cwd(),
      includeFolders,
      excludeFolders: excludePackageDirectories.length > 0 ? excludePackageDirectories : undefined,
      systemPrompt: SALESFORCE_METADATA_SYSTEM_PROMPT,
      teamName,
      model: flags.model,
      maxDiffChars: maxDiffCharsFlag,
      commitMessageIncludeRegexes: commitMessageIncludeRegexes.length > 0 ? commitMessageIncludeRegexes : undefined,
      commitMessageExcludeRegexes: commitMessageExcludeFromFlag.length > 0 ? commitMessageExcludeFromFlag : undefined,
    });

    await writeFile(outputPath, summary, 'utf8');
    this.log(`Generated metadata summary at ${outputPath}`);

    return { path: outputPath };
  }
}
