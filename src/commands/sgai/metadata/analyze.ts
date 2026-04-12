import { writeFile } from 'node:fs/promises';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { createGitClient, filterCommits, getCommits, getDiff, getChangedFiles } from '../../../git/gitDiff.js';
import { generateSummary, type AnalyzeFlags } from '../../../ai/metadataSummary.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-git-ai-meta-insights', 'sgai.metadata.analyze');

export type SgaiMetadataAnalyzeResult = {
  path: string;
};

export default class SgaiMetadataAnalyze extends SfCommand<SgaiMetadataAnalyzeResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    from: Flags.string({
      summary: messages.getMessage('flags.from.summary'),
      description: messages.getMessage('flags.from.description'),
      char: 'f',
      required: false,
    }),
    to: Flags.string({
      summary: messages.getMessage('flags.to.summary'),
      description: messages.getMessage('flags.to.description'),
      char: 't',
      required: false,
    }),
    'message-filter': Flags.string({
      summary: messages.getMessage('flags.message-filter.summary'),
      description: messages.getMessage('flags.message-filter.description'),
      char: 'm',
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
      default: 'gpt-4o-mini',
    }),
    'ignore-package-directory': Flags.directory({
      summary: messages.getMessage('flags.ignore-package-directory.summary'),
      description: messages.getMessage('flags.ignore-package-directory.description'),
      char: 'i',
      required: false,
      multiple: true,
    }),
  };

  public async run(): Promise<SgaiMetadataAnalyzeResult> {
    const { flags } = await this.parse(SgaiMetadataAnalyze);

    const from = flags.from ?? 'HEAD~1';
    const to = flags.to ?? 'HEAD';
    const outputPath = flags.output ?? 'metadata-summary.md';
    const ignorePackageDirectories = Array.isArray(flags['ignore-package-directory'])
      ? flags['ignore-package-directory'].filter(Boolean)
      : flags['ignore-package-directory']
      ? [flags['ignore-package-directory']]
      : undefined;
    const git = createGitClient(process.cwd());

    const commits = await getCommits(git, from, to);
    const filteredCommits = filterCommits(commits, flags['message-filter']);

    if (flags['message-filter'] && filteredCommits.length === 0) {
      const message = `No commits matched the filter '${flags['message-filter']}' between ${from} and ${to}.`;
      await writeFile(outputPath, `# Metadata Summary\n\n${message}\n`, 'utf8');
      this.log(`Generated metadata summary at ${outputPath}`);
      return { path: outputPath };
    }

    const diffText = await getDiff(
      git,
      from,
      to,
      filteredCommits,
      Boolean(flags['message-filter']),
      ignorePackageDirectories
    );
    const fileNames = await getChangedFiles(
      git,
      from,
      to,
      filteredCommits,
      Boolean(flags['message-filter']),
      ignorePackageDirectories
    );
    const summary = await generateSummary(diffText, fileNames, filteredCommits, flags as AnalyzeFlags);

    await writeFile(outputPath, summary, 'utf8');
    this.log(`Generated metadata summary at ${outputPath}`);

    return { path: outputPath };
  }
}
