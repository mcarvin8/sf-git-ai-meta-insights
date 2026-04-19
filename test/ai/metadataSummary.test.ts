import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { generateSummary, resolveLlmMaxDiffChars, truncateUnifiedDiffForLlm } from '@mcarvin/smart-diff';

describe('metadataSummary helpers', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_DEFAULT_HEADERS;
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.OPENAI_MAX_TOKENS;
    delete process.env.LLM_MAX_DIFF_CHARS;
  });

  it('resolveLlmMaxDiffChars falls back to default when LLM_MAX_DIFF_CHARS is not a positive integer', () => {
    process.env.LLM_MAX_DIFF_CHARS = 'not-a-number';
    expect(resolveLlmMaxDiffChars(undefined)).toBe(120_000);
    process.env.LLM_MAX_DIFF_CHARS = '0';
    expect(resolveLlmMaxDiffChars(undefined)).toBe(120_000);
    process.env.LLM_MAX_DIFF_CHARS = '-10';
    expect(resolveLlmMaxDiffChars(undefined)).toBe(120_000);
  });

  it('resolveLlmMaxDiffChars ignores NaN CLI override', () => {
    process.env.LLM_MAX_DIFF_CHARS = '5000';
    expect(resolveLlmMaxDiffChars(Number.NaN)).toBe(5000);
  });

  it('truncateUnifiedDiffForLlm appends marker when diff exceeds maxChars', () => {
    const out = truncateUnifiedDiffForLlm('abcdef', 3);
    expect(out.startsWith('abc')).toBe(true);
    expect(out).toContain('TRUNCATED:');
    expect(out).toContain('6 characters');
  });
});

describe('metadataSummary generateSummary LLM edge cases', () => {
  beforeEach(() => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_DEFAULT_HEADERS;
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.OPENAI_MAX_TOKENS;
    delete process.env.LLM_MAX_DIFF_CHARS;
    delete process.env.OPENAI_API_KEY;
  });

  it('includes commit message include regexes in OpenAI user content', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';

    await generateSummary({
      diffText: 'diff --git a/x b/x\n',
      fileNames: ['force-app/main/default/classes/Foo.cls'],
      commits: [{ hash: 'aaaaaaaaaaaaaaaa', message: 'fix stuff' }],
      flags: { from: 'HEAD~2', to: 'HEAD', commitMessageIncludeRegexes: ['(fix|feat)'] },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
    });

    const calls = openAiCreate.mock.calls as unknown[];
    const userMsg =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userMsg).toContain('Commit message include regexes (OR):');
    expect(userMsg).toContain('(fix|feat)');
    expect(userMsg).toContain('concatenated per-commit unified patches');

    delete process.env.OPENAI_API_KEY;
  });

  it('includes structured JSON diff summary in OpenAI user content when provided', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';

    await generateSummary({
      diffText: 'diff --git a/x b/x\n',
      fileNames: ['force-app/main/default/classes/Foo.cls'],
      commits: [{ hash: 'aaaaaaaaaaaaaaaa', message: 'fix stuff' }],
      flags: { from: 'HEAD~2', to: 'HEAD' },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
      diffSummary: {
        files: [
          {
            path: 'force-app/main/default/classes/Foo.cls',
            status: 'modified',
            additions: 3,
            deletions: 1,
          },
        ],
        totalFiles: 1,
        totalAdditions: 3,
        totalDeletions: 1,
      },
    });

    const calls = openAiCreate.mock.calls as unknown[];
    const userMsg =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userMsg).toContain('=== Structured git context (JSON summary) ===');
    expect(userMsg).toContain('"path": "force-app/main/default/classes/Foo.cls"');

    delete process.env.OPENAI_API_KEY;
  });

  it('callOpenAi uses max_tokens 4000 when LLM_MAX_TOKENS is invalid', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'x' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';
    process.env.LLM_MAX_TOKENS = 'not-a-number';

    await generateSummary({
      diffText: 'diff\n',
      fileNames: [],
      commits: [],
      flags: { from: 'HEAD~1' },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
    });

    const calls = openAiCreate.mock.calls as unknown as Array<[{ max_tokens?: number }]>;
    expect(calls[0][0].max_tokens).toBe(4000);

    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MAX_TOKENS;
  });

  it('callOpenAi passes max_tokens from OPENAI_MAX_TOKENS when valid', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'x' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_MAX_TOKENS = '2048';

    await generateSummary({
      diffText: 'diff\n',
      fileNames: [],
      commits: [],
      flags: { from: 'HEAD~1' },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
    });

    const calls = openAiCreate.mock.calls as unknown as Array<[{ max_tokens?: number }]>;
    expect(calls[0][0].max_tokens).toBe(2048);

    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MAX_TOKENS;
  });

  it('callOpenAi returns default message when choices are empty', async () => {
    const openAiCreate = jest.fn(async () => ({ choices: [] }));

    process.env.OPENAI_API_KEY = 'k';

    const summary = await generateSummary({
      diffText: 'diff\n',
      fileNames: [],
      commits: [],
      flags: { from: 'HEAD~1' },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
    });

    expect(summary).toBe('No summary generated by OpenAI.');

    delete process.env.OPENAI_API_KEY;
  });

  it('passes structured diff summary into the model user message when diffSummary is provided', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'model output' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';

    await generateSummary({
      diffText: 'diff snippet',
      fileNames: ['force-app/main/default/classes/Foo.cls'],
      commits: [{ hash: 'aaaaaaaaaaaaaaaa', message: 'feat' }],
      flags: { from: 'HEAD~1', to: 'HEAD' },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
      diffSummary: {
        files: [{ path: 'force-app/main/default/classes/Foo.cls', status: 'modified', additions: 1, deletions: 0 }],
        totalFiles: 1,
        totalAdditions: 1,
        totalDeletions: 0,
      },
    });

    const calls = openAiCreate.mock.calls as unknown[];
    const userMsg =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userMsg).toContain('=== Structured git context (JSON summary) ===');
    expect(userMsg).toContain('"path": "force-app/main/default/classes/Foo.cls"');

    delete process.env.OPENAI_API_KEY;
  });

  it('callOpenAi returns default message when content is only whitespace', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: '  \n\t  ' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';

    const summary = await generateSummary({
      diffText: 'diff\n',
      fileNames: [],
      commits: [],
      flags: { from: 'HEAD~1' },
      openAiClientProvider: async () => ({
        chat: { completions: { create: openAiCreate } },
      }),
    });

    expect(summary).toBe('No summary generated by OpenAI.');

    delete process.env.OPENAI_API_KEY;
  });
});
