import { writeFile } from 'node:fs/promises';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { createGitClient, filterCommits, getCommits, getDiff, getChangedFiles } from '../../../git/gitDiff.js';
import { generateSummary } from '../../../ai/metadataSummary.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-git-ai-meta-insights', 'sgai.metadata.summarize');

export type SgaiMetadataSummarizeResult = {
  path: string;
};

export default class SgaiMetadataSummarize extends SfCommand<SgaiMetadataSummarizeResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
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
    'message-filter': Flags.string({
      summary: messages.getMessage('flags.message-filter.summary'),
      description: messages.getMessage('flags.message-filter.description'),
      char: 'm',
      required: false,
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

  public async run(): Promise<SgaiMetadataSummarizeResult> {
    const { flags } = await this.parse(SgaiMetadataSummarize);

    const from = flags.from;
    const to = flags.to ?? 'HEAD';
    const outputPath = flags.output ?? 'metadata-summary.md';
    const ignorePackageDirectories = Array.isArray(flags['ignore-package-directory'])
      ? flags['ignore-package-directory'].filter(Boolean)
      : flags['ignore-package-directory']
      ? [flags['ignore-package-directory']]
      : undefined;
    const git = createGitClient(process.cwd());

    const commits = await getCommits(git, from, to);
    let filteredCommits;
    try {
      filteredCommits = filterCommits(commits, flags['message-filter']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Invalid commit message filter')) {
        throw new SfError(message, 'InvalidMessageFilter');
      }
      throw err;
    }

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
    const summary = await generateSummary(diffText, fileNames, filteredCommits, {
      from,
      to: flags.to,
      messageFilter: flags['message-filter'],
      model: flags.model,
      team: flags.team,
    });

    await writeFile(outputPath, summary, 'utf8');
    this.log(`Generated metadata summary at ${outputPath}`);

    return { path: outputPath };
  }
}
