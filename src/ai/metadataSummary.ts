import type { CommitInfo } from '../git/gitDiff.js';
import { createOpenAiLikeClient, shouldUseLlmGateway, type OpenAiLikeClient } from './openAiConfig.js';

/**
 * Cap on unified-diff characters sent to the LLM (only the diff body; preamble is extra).
 * Tuned for ~128k-token context models; override with `LLM_MAX_DIFF_CHARS` or `--max-diff-chars`.
 */
const DEFAULT_LLM_MAX_DIFF_CHARS = 120_000;

/** Resolve max unified-diff characters for the LLM path. CLI wins, then env, then default. */
export function resolveLlmMaxDiffChars(cliOverride?: number): number {
  if (cliOverride !== undefined && Number.isFinite(cliOverride) && cliOverride > 0) {
    return Math.trunc(cliOverride);
  }
  const raw = process.env.LLM_MAX_DIFF_CHARS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_LLM_MAX_DIFF_CHARS;
}

export function truncateUnifiedDiffForLlm(diffText: string, maxChars: number): string {
  if (diffText.length <= maxChars) {
    return diffText;
  }
  const marker = `\n\n--- TRUNCATED: unified diff was ${diffText.length} characters; only the first ${maxChars} were sent. Narrow the ref range, use --message-filter, or raise --max-diff-chars / LLM_MAX_DIFF_CHARS only if your model context allows. ---\n`;
  return diffText.slice(0, maxChars) + marker;
}

/** System prompt for OpenAI when summarizing whatever git range / filter the user requested. */
const OPENAI_SYSTEM_PROMPT = `You are a senior Salesforce architect helping developers understand Salesforce metadata changes from the git context they supplied.
You receive: commit subject lines (when available), changed metadata paths, and unified git patch(es) scoped to Salesforce metadata package directories—either one range diff or concatenated per-commit patches, depending on how the diff was produced. Patches may be truncated mid-section with an explicit marker—do not infer changes beyond visible lines.
Explain what functionality changed: user-visible behavior, automations, integrations, data model, and security/access. Tie claims to the patch when possible.
Produce a concise, developer-focused summary in Markdown.
Use sections: Highlights, Risky or breaking changes, Data model changes, Automation & flows, Security & access.
Group related changes; do not list every individual component or file. When multiple commits appear in the context, briefly separate notable themes by commit when helpful.`;

export type SummarizeFlags = {
  /** Start ref for the diff (required when invoking the CLI). */
  from: string;
  to?: string;
  messageFilter?: string;
  model?: string;
  /** Optional team or squad label for the summary (CLI or env). */
  team?: string;
  /** Max characters of unified diff sent to the LLM (CLI); see `resolveLlmMaxDiffChars`. */
  maxDiffChars?: number;
};

function resolveSummaryTeam(flags: SummarizeFlags): string | undefined {
  const fromFlag = flags.team?.trim();
  if (fromFlag) return fromFlag;
  const auditTeam = process.env.METADATA_AUDIT_TEAM?.trim();
  if (auditTeam) return auditTeam;
  const sfGitAiTeam = process.env.SF_GIT_AI_TEAM?.trim();
  return sfGitAiTeam ?? undefined;
}

type OpenAiClientProvider = () => Promise<OpenAiLikeClient>;

export async function generateSummary(
  diffText: string,
  fileNames: string[],
  commits: CommitInfo[],
  flags: SummarizeFlags,
  openAiClientProvider?: OpenAiClientProvider
): Promise<string> {
  const fileSection = fileNames.length
    ? fileNames.map((name) => `- ${name}`).join('\n')
    : '- No metadata files changed.';

  if (shouldUseLlmGateway()) {
    const maxDiffChars = resolveLlmMaxDiffChars(flags.maxDiffChars);
    const diffForLlm = truncateUnifiedDiffForLlm(diffText, maxDiffChars);
    const userContent = buildOpenAiUserContent(flags, commits, fileNames, diffForLlm);
    return callOpenAi(
      userContent,
      flags.model ?? 'gpt-4o-mini',
      openAiClientProvider ??
        /* istanbul ignore next */ (async (): Promise<OpenAiLikeClient> => createOpenAiLikeClient())
    );
  }

  return buildFallbackSummary(fileSection, commits, diffText, flags);
}

function buildOpenAiUserContent(
  flags: SummarizeFlags,
  commits: CommitInfo[],
  fileNames: string[],
  diffText: string
): string {
  const from = flags.from;
  const to = flags.to ?? 'HEAD';
  const team = resolveSummaryTeam(flags);
  const ts = new Date().toISOString();
  const teamLine = team ? `Team: ${team}\n` : '';
  const filterLine = flags.messageFilter
    ? `Commit message filter (regex): ${flags.messageFilter}\nGit context shape: concatenated per-commit unified patches for matching commits only.\n`
    : 'Commit message filter: none.\nGit context shape: single unified diff for the full ref range.\n';

  const commitBlock =
    commits.length > 0
      ? commits.map((c) => `- ${c.hash.slice(0, 7)} ${c.message.replace(/\r?\n/g, ' ')}`).join('\n')
      : '- (no commits in range after filtering)';

  const pathsBlock = fileNames.length > 0 ? fileNames.join('\n') : '(no metadata paths in diff scope)';

  return (
    `${teamLine}` +
    `Date: ${ts}\n\n` +
    `Git refs: ${from}..${to}\n` +
    filterLine +
    '\n' +
    '=== Included commits (subject lines) ===\n' +
    `${commitBlock}\n\n` +
    '=== Changed metadata paths ===\n' +
    `${pathsBlock}\n\n` +
    '=== Git context (unified diff(s) scoped to Salesforce metadata paths; patches may be truncated with an explicit marker) ===\n' +
    diffText
  );
}

function buildFallbackSummary(
  fileSection: string,
  commits: CommitInfo[],
  diffText: string,
  flags: SummarizeFlags
): string {
  const filterText = flags.messageFilter
    ? `Filtered by: \`${flags.messageFilter}\`\n\n`
    : 'No commit message filter applied.\n\n';

  const team = resolveSummaryTeam(flags);
  const teamSection = team ? `## Team\n${team}\n\n` : '';

  return (
    '# Metadata Change Summary\n\n' +
    '## Range\n' +
    `From: ${flags.from}\n` +
    `To: ${flags.to ?? 'HEAD'}\n\n` +
    teamSection +
    '## Commit Filter\n' +
    filterText +
    `## Changed Files\n${fileSection}\n\n` +
    '## Local Summary\n' +
    'No LLM gateway was configured (set `OPENAI_API_KEY` or `LLM_API_KEY`, `OPENAI_BASE_URL` or `LLM_BASE_URL`, and/or `OPENAI_DEFAULT_HEADERS` / `LLM_DEFAULT_HEADERS`), so this is a local summary instead.\n\n' +
    '### Commits\n' +
    commits.map((commit) => `- ${commit.hash.slice(0, 7)} ${commit.message}`).join('\n') +
    `\n\n### Diff Snippet\n\n${diffText.substring(0, 10_000)}`
  );
}

async function callOpenAi(
  userContent: string,
  model: string,
  openAiClientProvider: OpenAiClientProvider
): Promise<string> {
  const client = await openAiClientProvider();
  const maxTokensRaw = process.env.LLM_MAX_TOKENS ?? process.env.OPENAI_MAX_TOKENS;
  const parsed = maxTokensRaw !== undefined ? Number.parseInt(maxTokensRaw, 10) : 4000;
  const maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: OPENAI_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    temperature: 0.2,
    // OpenAI Chat Completions API uses snake_case for this field.
    // eslint-disable-next-line camelcase -- matches OpenAI request body
    max_tokens: maxTokens,
  });

  const typedResponse = response as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = typedResponse.choices?.[0]?.message?.content?.trim() ?? '';
  return text.length > 0 ? text : 'No summary generated by OpenAI.';
}
