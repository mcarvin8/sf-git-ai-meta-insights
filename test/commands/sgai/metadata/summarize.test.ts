import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import {
  createGitClient,
  filterCommitsByMessageRegexes,
  getCommits,
  getDiff,
  getDiffSummary,
  getChangedFiles,
  getRepoRoot,
  generateSummary,
  resolveLlmMaxDiffChars,
  truncateUnifiedDiffForLlm,
} from '@mcarvin/smart-diff';

/* eslint-disable @typescript-eslint/unbound-method */
import pluginIndex from '../../../../src/index.js';

import type { GitClient } from '../../../../src/salesforce/sfdxPackagePaths.js';

const repoRoot = process.cwd();

describe('sgai metadata summary generator', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.LLM_DEFAULT_HEADERS;
    delete process.env.OPENAI_DEFAULT_HEADERS;
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.OPENAI_MAX_TOKENS;
    delete process.env.LLM_MAX_DIFF_CHARS;
    delete process.env.METADATA_AUDIT_TEAM;
    delete process.env.SF_GIT_AI_TEAM;
  });

  it('generateSummary throws when no LLM gateway is configured and no client provider is passed', async () => {
    await expect(generateSummary('diff --git a/foo b/foo\nindex 123..456', [], [], { from: 'HEAD~1' })).rejects.toThrow(
      /No LLM gateway configured/
    );
  });

  it('includes commit message include regexes in the model user message when provided', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'k';

    const diffText = 'diff --git a/bar b/bar\nindex 999..000';
    const commits = [{ hash: '1234567890abcdef', message: 'Fix bug in metadata analyzer' }];

    await generateSummary(
      diffText,
      [],
      commits,
      { from: 'HEAD~5', to: 'HEAD', commitMessageIncludeRegexes: ['Fix bug'] },
      async () => ({
        chat: { completions: { create: openAiCreate } },
      })
    );

    const calls = openAiCreate.mock.calls as unknown[];
    const userMsg =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userMsg).toContain('Git refs: HEAD~5..HEAD');
    expect(userMsg).toContain('Commit message include regexes (OR):');
    expect(userMsg).toContain('Fix bug');

    delete process.env.OPENAI_API_KEY;
  });

  it('truncates oversized diff for the LLM using LLM_MAX_DIFF_CHARS', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'truncated ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LLM_MAX_DIFF_CHARS = '20000';
    const hugeDiff = `diff --git a/x b/x\n${'y'.repeat(50_000)}`;

    await generateSummary(hugeDiff, [], [{ hash: 'a', message: 'm' }], { from: 'HEAD~1' }, async () => ({
      chat: { completions: { create: openAiCreate } },
    }));

    const calls = openAiCreate.mock.calls as unknown[];
    const userMsg =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userMsg).toContain('TRUNCATED:');
    expect(userMsg.length).toBeLessThan(hugeDiff.length + 5000);

    delete process.env.OPENAI_API_KEY;
  });

  it('resolveLlmMaxDiffChars prefers CLI override over env', () => {
    process.env.LLM_MAX_DIFF_CHARS = '5000';
    expect(resolveLlmMaxDiffChars(99_000)).toBe(99_000);
    delete process.env.LLM_MAX_DIFF_CHARS;
    expect(resolveLlmMaxDiffChars(undefined)).toBe(120_000);
  });

  it('truncateUnifiedDiffForLlm leaves short diffs unchanged', () => {
    expect(truncateUnifiedDiffForLlm('small', 100)).toBe('small');
  });

  it('uses OpenAI when OPENAI_API_KEY is available', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'AI generated summary' } }],
    }));

    process.env.OPENAI_API_KEY = 'test-key';

    const summary = await generateSummary(
      'diff --git a/b b/b\nindex 1..2',
      ['force-app/main/default/classes/AccountProfile.cls'],
      [{ hash: 'abcdef1234567890', message: 'Add metadata summary support' }],
      { from: 'HEAD~1' },
      async () => ({
        chat: { completions: { create: openAiCreate } },
      })
    );

    expect(summary).toContain('AI generated summary');
    expect(openAiCreate).toHaveBeenCalled();
    const calls = openAiCreate.mock.calls as unknown[];
    const userContent =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userContent).not.toContain('Team:');

    delete process.env.OPENAI_API_KEY;
  });

  it('uses LLM path when only LLM_BASE_URL is set (no OPENAI_API_KEY)', async () => {
    process.env.LLM_BASE_URL = 'http://gateway.example.invalid';

    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'LLM-gated summary' } }],
    }));

    const summary = await generateSummary(
      'diff --git a/b b/b\n',
      [],
      [{ hash: 'abcdef1234567890', message: 'm' }],
      { from: 'HEAD~1' },
      async () => ({
        chat: { completions: { create: openAiCreate } },
      })
    );

    expect(summary).toContain('LLM-gated summary');
    expect(openAiCreate).toHaveBeenCalled();
  });

  it('includes Team in the OpenAI user message when --team is set', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'test-key';

    await generateSummary('diff --git a/b b/b\n', [], [], { from: 'HEAD~1', team: '  Platform  ' }, async () => ({
      chat: { completions: { create: openAiCreate } },
    }));

    const calls = openAiCreate.mock.calls as unknown[];
    const userMsg =
      ((calls[0] as unknown[])?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[1]?.content ?? '';
    expect(userMsg).toMatch(/^Team: Platform\n/);

    delete process.env.OPENAI_API_KEY;
  });

  it('returns all commits when no filter is provided', () => {
    const commits = [
      { hash: 'a1', message: 'Add feature' },
      { hash: 'b2', message: 'Fix bug' },
    ];

    expect(filterCommitsByMessageRegexes(commits)).toEqual(commits);
  });

  it('filters commits using a message regex', () => {
    const commits = [
      { hash: 'a1', message: 'Add feature' },
      { hash: 'b2', message: 'Fix bug' },
    ];

    expect(filterCommitsByMessageRegexes(commits, ['fix'])).toEqual([{ hash: 'b2', message: 'Fix bug' }]);
  });

  it('throws when commit-message-include is not a valid regular expression', () => {
    expect(() => filterCommitsByMessageRegexes([{ hash: '1', message: 'x' }], ['['])).toThrow(
      /Invalid commit message include pattern/
    );
  });

  it('parses numstat name-status output into a structured diff summary', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-diff-summary-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      'utf8'
    );

    const git = {
      diff: jest.fn(async (args: string[]) => {
        if (args.includes('--name-status')) {
          return (
            'A\tforce-app/main/default/classes/Foo.cls\n' +
            'R100\tforce-app/main/default/classes/Bar.cls\tforce-app/main/default/classes/Baz.cls\n' +
            'X\tforce-app/main/default/classes/Unknown.cls\n' +
            'bad-line-without-tabs\n'
          );
        }
        if (args.includes('--numstat')) {
          return (
            '10\t1\tforce-app/main/default/classes/Foo.cls\n' +
            '0\t0\tforce-app/main/default/classes/{Bar.cls => Baz.cls}\n' +
            '-\t-\tforce-app/main/default/classes/Unknown.cls\n'
          );
        }
        return '';
      }),
      revparse: jest.fn(async () => tmpRoot),
    } as unknown as GitClient;

    const summary = await getDiffSummary(git, 'HEAD~1', 'HEAD', [], false, { includeFolders: ['force-app'] }, tmpRoot);

    expect(summary.totalFiles).toBe(3);
    expect(summary.totalAdditions).toBe(10);
    expect(summary.totalDeletions).toBe(1);
    expect(summary.files).toEqual(
      expect.arrayContaining([
        {
          path: 'force-app/main/default/classes/Foo.cls',
          status: 'added',
          additions: 10,
          deletions: 1,
        },
        {
          path: 'force-app/main/default/classes/Baz.cls',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          oldPath: 'force-app/main/default/classes/Bar.cls',
          newPath: 'force-app/main/default/classes/Baz.cls',
        },
        {
          path: 'force-app/main/default/classes/Unknown.cls',
          status: 'unknown',
          additions: 0,
          deletions: 0,
        },
      ])
    );

    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('aggregates multiple commit diffs when filtering by commit', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-diff-summary-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      'utf8'
    );

    const git = {
      diff: jest.fn(async (args: string[]) => {
        if (args.includes('--name-status')) {
          return 'M\tforce-app/main/default/classes/Foo.cls\n';
        }
        if (args.includes('--numstat')) {
          return '1\t2\tforce-app/main/default/classes/Foo.cls\n';
        }
        return '';
      }),
      revparse: jest.fn(async () => tmpRoot),
    } as unknown as GitClient;

    const commits = [
      { hash: 'c1', message: 'commit 1' },
      { hash: 'c2', message: 'commit 2' },
    ];
    const summary = await getDiffSummary(
      git,
      'HEAD~2',
      'HEAD',
      commits,
      true,
      { includeFolders: ['force-app'] },
      tmpRoot
    );

    expect(git.diff).toHaveBeenCalledTimes(4);
    expect(git.diff).toHaveBeenCalledWith(['--numstat', 'c1^!', '--', 'force-app']);
    expect(git.diff).toHaveBeenCalledWith(['--name-status', 'c1^!', '--', 'force-app']);
    expect(git.diff).toHaveBeenCalledWith(['--numstat', 'c2^!', '--', 'force-app']);
    expect(git.diff).toHaveBeenCalledWith(['--name-status', 'c2^!', '--', 'force-app']);
    expect(summary.totalFiles).toBe(1);
    expect(summary.totalAdditions).toBe(2);
    expect(summary.totalDeletions).toBe(4);
    expect(summary.files[0]).toEqual({
      path: 'force-app/main/default/classes/Foo.cls',
      status: 'modified',
      additions: 2,
      deletions: 4,
    });

    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates a git client for a cwd', () => {
    const client = createGitClient(repoRoot);
    expect(client).toBeDefined();
  });

  it('fetches commits from git log', async () => {
    const git = {
      log: jest.fn(async () => ({ all: [{ hash: 'a', message: 'm' }] })),
    } as unknown as GitClient;

    const commits = await getCommits(git, 'HEAD~1', 'HEAD');

    expect(commits).toEqual([{ hash: 'a', message: 'm' }]);
    expect(git.log).toHaveBeenCalledWith({ from: 'HEAD~1', to: 'HEAD' });
  });

  it('exports the CLI plugin index', () => {
    expect(pluginIndex).toEqual({});
  });

  describe('sfdx package directory filtering', () => {
    let testRepoRoot: string;

    beforeAll(async () => {
      testRepoRoot = await mkdtemp(join(tmpdir(), 'sgai-repo-'));

      await writeFile(
        join(testRepoRoot, 'sfdx-project.json'),
        JSON.stringify({
          packageDirectories: [{ path: 'force-app' }, { path: 'included-app' }],
        }),
        'utf8'
      );

      await mkdir(join(testRepoRoot, 'force-app/main'), { recursive: true });
      await mkdir(join(testRepoRoot, 'included-app/main'), { recursive: true });
    });

    afterAll(async () => {
      await rm(testRepoRoot, { recursive: true, force: true });
    });

    it('filters ignored package directories from git diff path specs', async () => {
      const git = {
        diff: jest.fn(async () => 'diff'),
      } as unknown as GitClient;

      await getDiff(git, 'HEAD~1', 'HEAD', [], false, { excludeFolders: ['force-app'] }, testRepoRoot);

      expect(git.diff).toHaveBeenCalledWith(['HEAD~1..HEAD', '--', '.', ':(exclude)force-app']);
    });

    it('returns no changed files when all package directories are ignored', async () => {
      const git = {
        diff: jest.fn(async () => ''),
        show: jest.fn(async () => ''),
      } as unknown as GitClient;

      const files = await getChangedFiles(
        git,
        'HEAD~1',
        'HEAD',
        [],
        false,
        { excludeFolders: ['force-app', 'included-app'] },
        testRepoRoot
      );

      expect(files).toEqual([]);
    });

    it('queries commit diffs when filtering by commit', async () => {
      const git = {
        diff: jest.fn(async () => 'patch'),
      } as unknown as GitClient;

      const result = await getDiff(
        git,
        'HEAD~3',
        'HEAD',
        [{ hash: 'abcdef1', message: 'commit' }],
        true,
        { excludeFolders: ['force-app'] },
        testRepoRoot
      );

      expect(result).toBe('patch');
      expect(git.diff).toHaveBeenCalledWith(['abcdef1^!', '--', '.', ':(exclude)force-app']);
    });

    it('returns a structured diff summary in JSON-compatible form', async () => {
      const git = {
        diff: jest.fn(async (args: string[]) => {
          if (args.includes('--name-status')) {
            return (
              'A\tforce-app/main/default/classes/Foo.cls\n' +
              'R100\tforce-app/main/default/classes/Bar.cls\tforce-app/main/default/classes/Baz.cls\n'
            );
          }
          if (args.includes('--numstat')) {
            return (
              '10\t1\tforce-app/main/default/classes/Foo.cls\n' +
              '0\t0\tforce-app/main/default/classes/{Bar.cls => Baz.cls}\n'
            );
          }
          return '';
        }),
      } as unknown as GitClient;

      const summary = await getDiffSummary(
        git,
        'HEAD~1',
        'HEAD',
        [],
        false,
        { excludeFolders: ['force-app'] },
        testRepoRoot
      );

      expect(summary.totalFiles).toBe(2);
      expect(summary.totalAdditions).toBe(10);
      expect(summary.totalDeletions).toBe(1);
      expect(summary.files).toEqual([
        {
          path: 'force-app/main/default/classes/Foo.cls',
          status: 'added',
          additions: 10,
          deletions: 1,
        },
        {
          path: 'force-app/main/default/classes/Baz.cls',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          oldPath: 'force-app/main/default/classes/Bar.cls',
          newPath: 'force-app/main/default/classes/Baz.cls',
        },
      ]);
    });

    it('returns empty diff when all package directories are ignored', async () => {
      const git = {
        diff: jest.fn(async () => ''),
      } as unknown as GitClient;

      const result = await getDiff(
        git,
        'HEAD~3',
        'HEAD',
        [],
        false,
        { excludeFolders: ['force-app', 'included-app'] },
        testRepoRoot
      );

      expect(result).toBe('');
    });

    it('returns changed files without commit filter', async () => {
      const git = {
        diff: jest.fn(async () => 'included-app/main/changed.cls\n'),
      } as unknown as GitClient;

      const files = await getChangedFiles(
        git,
        'HEAD~3',
        'HEAD',
        [],
        false,
        { excludeFolders: ['force-app'] },
        testRepoRoot
      );

      expect(files).toEqual(['included-app/main/changed.cls']);
    });

    it('passes pathspecs to git show when filtering by commit', async () => {
      const git = {
        show: jest.fn(async () => 'force-app/x.cls\nincluded-app/x.cls\n'),
      } as unknown as GitClient;

      const files = await getChangedFiles(
        git,
        'HEAD~3',
        'HEAD',
        [{ hash: 'abc', message: 'commit' }],
        true,
        { includeFolders: ['force-app', 'included-app'] },
        testRepoRoot
      );

      expect(files).toEqual(['force-app/x.cls', 'included-app/x.cls']);
      expect(git.show).toHaveBeenCalled();
      const showArgs = (git.show as jest.Mock).mock.calls[0][0] as string[];
      expect(showArgs).toContain('--name-only');
      expect(showArgs).toContain('abc');
    });
    it('resolves repo root using git rev-parse', async () => {
      const git = {
        revparse: jest.fn(async () => ' /fake/repo/root\n'),
      } as unknown as GitClient;

      const root = await getRepoRoot(git);

      expect(root).toBe('/fake/repo/root');
      expect(git.revparse).toHaveBeenCalledWith(['--show-toplevel']);
    });
    it('uses repoRootOverride instead of git rev-parse', async () => {
      const git = {
        diff: jest.fn(async () => ''),
        show: jest.fn(async () => ''),
        revparse: jest.fn(async () => '/SHOULD-NOT-BE-CALLED'),
      } as unknown as GitClient;

      const override = '/custom/root';

      await getDiff(git, 'a', 'b', [], false, undefined, override);

      expect(git.revparse).not.toHaveBeenCalled();
    });
    it('creates git client with cwd', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'sgai-git-'));

      const client = createGitClient(tmp);

      expect(client).toBeDefined();

      await rm(tmp, { recursive: true, force: true });
    });
    it('getCommits returns mapped commit list', async () => {
      const git = {
        log: jest.fn(async () => ({
          all: [{ hash: 'abc', message: 'msg' }],
        })),
      } as unknown as GitClient;

      const res = await getCommits(git, 'a', 'b');

      expect(res).toEqual([{ hash: 'abc', message: 'msg' }]);
      expect(git.log).toHaveBeenCalledWith({ from: 'a', to: 'b' });
    });
    it('filterCommitsByMessageRegexes returns unfiltered commits when include patterns are undefined', () => {
      const commits = [
        { hash: '1', message: 'hello' },
        { hash: '2', message: 'world' },
      ];

      expect(filterCommitsByMessageRegexes(commits, undefined)).toEqual(commits);
    });
    it('covers empty string include pattern branch', () => {
      const commits = [
        { hash: '1', message: 'hello' },
        { hash: '2', message: 'world' },
      ];

      expect(filterCommitsByMessageRegexes(commits, [''])).toEqual(commits);
    });
    it('covers regex special characters in filterCommitsByMessageRegexes', () => {
      const commits = [
        { hash: '1', message: 'fix (critical)' },
        { hash: '2', message: 'add feature' },
      ];

      expect(filterCommitsByMessageRegexes(commits, ['(critical)'])).toEqual([
        { hash: '1', message: 'fix (critical)' },
      ]);
    });
    it('creates git client using default cwd when none provided', () => {
      const client = createGitClient();
      expect(client).toBeDefined();
    });
    it('getDiff returns empty string when excludes cover the scoped tree', async () => {
      const git = {
        revparse: jest.fn(async () => '/repo'),
        diff: jest.fn(async () => ''),
      } as unknown as GitClient;

      const result = await getDiff(
        git,
        'a',
        'b',
        [],
        false,
        { excludeFolders: ['force-app', 'included-app'] },
        '/repo'
      );

      expect(result).toBe('');
    });
    it('uses dot package path when package directory is the repo root', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-dotpkg-'));

      await writeFile(
        join(tmpRoot, 'sfdx-project.json'),
        JSON.stringify({
          packageDirectories: [{ path: '.' }],
        }),
        'utf8'
      );

      const git = {
        diff: jest.fn(async (args: string[]) => `diff-args:${args.join('|')}`),
        revparse: jest.fn(async () => tmpRoot),
      } as unknown as GitClient;

      await getDiff(git, 'a', 'b', [], false, { includeFolders: ['.'] }, tmpRoot);

      expect(git.diff).toHaveBeenCalled();
      const callArgs = (git.diff as jest.Mock).mock.calls[0][0] as string[];
      expect(callArgs).toContain('.');

      await rm(tmpRoot, { recursive: true, force: true });
    });

    it('accepts string entries in packageDirectories', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-str-pkg-'));

      await mkdir(join(tmpRoot, 'legacy-pkg'), { recursive: true });

      await writeFile(
        join(tmpRoot, 'sfdx-project.json'),
        JSON.stringify({
          packageDirectories: ['legacy-pkg'],
        }),
        'utf8'
      );

      const git = {
        diff: jest.fn(async () => 'ok'),
        revparse: jest.fn(async () => '/SHOULD-NOT-RUN'),
      } as unknown as GitClient;

      await getDiff(git, 'x', 'y', [], false, { includeFolders: ['legacy-pkg'] }, tmpRoot);

      expect(git.revparse).not.toHaveBeenCalled();
      const callArgs = (git.diff as jest.Mock).mock.calls[0][0] as string[];
      expect(callArgs).toContain('legacy-pkg');

      await rm(tmpRoot, { recursive: true, force: true });
    });

    it('filters empty and invalid package directory entries from sfdx-project.json', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-mixed-pkg-'));

      await mkdir(join(tmpRoot, 'force-app'), { recursive: true });
      await mkdir(join(tmpRoot, 'extra-pkg'), { recursive: true });

      await writeFile(
        join(tmpRoot, 'sfdx-project.json'),
        JSON.stringify({
          packageDirectories: [{ path: '' }, { path: 'force-app' }, {}, 'extra-pkg', { path: '   ' }],
        }),
        'utf8'
      );

      const git = {
        diff: jest.fn(async () => 'ok'),
        revparse: jest.fn(async () => tmpRoot),
      } as unknown as GitClient;

      await getDiff(git, 'x', 'y', [], false, { includeFolders: ['force-app', 'extra-pkg'] }, tmpRoot);

      const callArgs = (git.diff as jest.Mock).mock.calls[0][0] as string[];
      expect(callArgs).toContain('force-app');
      expect(callArgs).toContain('extra-pkg');

      await rm(tmpRoot, { recursive: true, force: true });
    });

    it('getDiff aggregates multiple commit patches correctly', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-'));

      await writeFile(
        join(tmpRoot, 'sfdx-project.json'),
        JSON.stringify({
          packageDirectories: [{ path: 'included-app' }],
        }),
        'utf8'
      );

      const git = {
        diff: jest.fn(async (args: string[]) => {
          const hash = args[0]; // c1^!
          return `patch-${hash}`;
        }),
        revparse: jest.fn(async () => tmpRoot),
      } as unknown as GitClient;

      const result = await getDiff(
        git,
        'a',
        'b',
        [
          { hash: 'c1', message: 'm1' },
          { hash: 'c2', message: 'm2' },
        ],
        true,
        { includeFolders: ['included-app'] },
        tmpRoot
      );

      expect(result).toContain('patch-c1^!');
      expect(result).toContain('patch-c2^!');

      await rm(tmpRoot, { recursive: true, force: true });
    });
  });
});
