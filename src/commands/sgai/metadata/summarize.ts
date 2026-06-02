import { writeFile } from 'node:fs/promises';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
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
  getValidatedCommitMessageRegexLists,
  resolveIncludeFoldersAndExclude,
  throwIfNoCommitsAfterMessageFilter,
  validateContextLinesRange,
  validateMaxDiffCharsRange,
  validateMaxHunkLinesRange,
} from '../../../metadata/summarizeHelpers.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-git-ai-meta-insights', 'sgai.metadata.summarize');

export type SgaiMetadataSummarizeResult = {
  path: string;
};

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
    'context-lines': Flags.integer({
      summary: messages.getMessage('flags.context-lines.summary'),
      description: messages.getMessage('flags.context-lines.description'),
      required: false,
    }),
    'ignore-whitespace': Flags.boolean({
      summary: messages.getMessage('flags.ignore-whitespace.summary'),
      description: messages.getMessage('flags.ignore-whitespace.description'),
      required: false,
      default: false,
    }),
    'strip-diff-preamble': Flags.boolean({
      summary: messages.getMessage('flags.strip-diff-preamble.summary'),
      description: messages.getMessage('flags.strip-diff-preamble.description'),
      required: false,
      default: false,
    }),
    'max-hunk-lines': Flags.integer({
      summary: messages.getMessage('flags.max-hunk-lines.summary'),
      description: messages.getMessage('flags.max-hunk-lines.description'),
      required: false,
    }),
    'exclude-default-noise': Flags.boolean({
      summary: messages.getMessage('flags.exclude-default-noise.summary'),
      description: messages.getMessage('flags.exclude-default-noise.description'),
      required: false,
      default: false,
    }),
  };

  public async run(): Promise<SgaiMetadataSummarizeResult> {
    const { flags } = await this.parse(SgaiMetadataSummarize);

    validateMaxDiffCharsRange(flags['max-diff-chars']);
    validateContextLinesRange(flags['context-lines']);
    validateMaxHunkLinesRange(flags['max-hunk-lines']);

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
      commitMessageExcludeFromFlag.length > 0 ? commitMessageExcludeFromFlag : undefined,
    );

    throwIfNoCommitsAfterMessageFilter(
      commits,
      filteredCommits,
      commitMessageIncludeRegexes,
      commitMessageExcludeFromFlag,
      messages.getMessage('errors.noCommitsAfterFilter', [
        from,
        to,
        JSON.stringify(commitMessageIncludeRegexes),
        JSON.stringify(commitMessageExcludeFromFlag),
      ]),
    );

    const teamName = resolveMetadataSummaryTeam(flags.team);

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
      maxDiffChars: flags['max-diff-chars'],
      commitMessageIncludeRegexes: commitMessageIncludeRegexes.length > 0 ? commitMessageIncludeRegexes : undefined,
      commitMessageExcludeRegexes: commitMessageExcludeFromFlag.length > 0 ? commitMessageExcludeFromFlag : undefined,
      contextLines: flags['context-lines'],
      ignoreWhitespace: flags['ignore-whitespace'] || undefined,
      stripDiffPreamble: flags['strip-diff-preamble'] || undefined,
      maxHunkLines: flags['max-hunk-lines'],
      excludeDefaultNoise: flags['exclude-default-noise'] || undefined,
    });

    await writeFile(outputPath, summary, 'utf8');
    this.log(`Generated metadata summary at ${outputPath}`);

    return { path: outputPath };
  }
}
