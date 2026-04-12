import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SimpleGit } from 'simple-git';
import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';

/* eslint-disable @typescript-eslint/unbound-method */
import pluginIndex from '../../../../src/index.js';
import { generateSummary } from '../../../../src/ai/metadataSummary.js';
import {
  createGitClient,
  getCommits,
  filterCommits,
  getDiff,
  getChangedFiles,
  getRepoRoot,
} from '../../../../src/git/gitDiff.js';

const repoRoot = process.cwd();

describe('sgai metadata summary generator', () => {
  it('generates a fallback summary without an OPENAI key', async () => {
    const diffText = 'diff --git a/foo b/foo\nindex 123..456';
    const fileNames = ['force-app/main/default/classes/AccountProfile.cls'];
    const commits = [{ hash: 'abcdef1234567890', message: 'Add metadata summary support' }];
    const flags = { from: 'HEAD~1' };

    const summary = await generateSummary(diffText, fileNames, commits, flags);

    expect(summary).toContain('# Metadata Change Summary');
    expect(summary).toContain('From: HEAD~1');
    expect(summary).toContain('To: HEAD');
    expect(summary).toContain('- abcdef1 Add metadata summary support');
    expect(summary).toContain('## Changed Files');
    expect(summary).toContain('force-app/main/default/classes/AccountProfile.cls');
  });

  it('includes the commit message filter details when provided', async () => {
    const diffText = 'diff --git a/bar b/bar\nindex 999..000';
    const fileNames: string[] = [];
    const commits = [{ hash: '1234567890abcdef', message: 'Fix bug in metadata analyzer' }];
    const flags = {
      from: 'HEAD~5',
      to: 'HEAD',
      messageFilter: 'Fix bug',
    };

    const summary = await generateSummary(diffText, fileNames, commits, flags);

    expect(summary).toContain('From: HEAD~5');
    expect(summary).toContain('To: HEAD');
    expect(summary).toContain('Filtered by: `Fix bug`');
    expect(summary).toContain('- No metadata files changed.');
    expect(summary).toContain('Fix bug in metadata analyzer');
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
    const calls = openAiCreate.mock.calls as unknown as Array<[{ messages: Array<{ role: string; content: string }> }]>;
    const userContent = calls[0][0].messages[1]?.content ?? '';
    expect(userContent).not.toContain('Team:');

    delete process.env.OPENAI_API_KEY;
  });

  it('includes Team in the OpenAI user message when --team is set', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'test-key';

    await generateSummary('diff --git a/b b/b\n', [], [], { from: 'HEAD~1', team: '  Platform  ' }, async () => ({
      chat: { completions: { create: openAiCreate } },
    }));

    const calls = openAiCreate.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>;
    const userMsg = calls[0][0].messages[1]?.content ?? '';
    expect(userMsg).toMatch(/^Team: Platform\n/);

    delete process.env.OPENAI_API_KEY;
  });

  it('includes Team section in fallback summary when team flag is set', async () => {
    const summary = await generateSummary('diff', [], [{ hash: 'a', message: 'm' }], {
      from: 'HEAD~1',
      team: 'Revenue Cloud',
    });
    expect(summary).toContain('## Team\nRevenue Cloud');
  });

  it('includes Team in fallback from METADATA_AUDIT_TEAM when flag unset', async () => {
    process.env.METADATA_AUDIT_TEAM = '  CI Team  ';
    const summary = await generateSummary('diff', [], [{ hash: 'a', message: 'm' }], { from: 'HEAD~1' });
    expect(summary).toContain('## Team\nCI Team');
    delete process.env.METADATA_AUDIT_TEAM;
  });

  it('includes Team in OpenAI user message from METADATA_AUDIT_TEAM', async () => {
    const openAiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'ok' } }],
    }));

    process.env.OPENAI_API_KEY = 'test-key';
    process.env.METADATA_AUDIT_TEAM = 'Squad A';

    await generateSummary('diff', [], [], { from: 'HEAD~1' }, async () => ({
      chat: { completions: { create: openAiCreate } },
    }));

    const calls = openAiCreate.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>;
    expect(calls[0][0].messages[1]?.content).toMatch(/^Team: Squad A\n/);

    delete process.env.OPENAI_API_KEY;
    delete process.env.METADATA_AUDIT_TEAM;
  });

  it('returns all commits when no filter is provided', () => {
    const commits = [
      { hash: 'a1', message: 'Add feature' },
      { hash: 'b2', message: 'Fix bug' },
    ];

    expect(filterCommits(commits)).toEqual(commits);
  });

  it('filters commits using a message regex', () => {
    const commits = [
      { hash: 'a1', message: 'Add feature' },
      { hash: 'b2', message: 'Fix bug' },
    ];

    expect(filterCommits(commits, 'fix')).toEqual([{ hash: 'b2', message: 'Fix bug' }]);
  });

  it('throws when message-filter is not a valid regular expression', () => {
    expect(() => filterCommits([{ hash: '1', message: 'x' }], '[')).toThrow(/Invalid commit message filter/);
  });

  it('creates a git client for a cwd', () => {
    const client = createGitClient(repoRoot);
    expect(client).toBeDefined();
  });

  it('fetches commits from git log', async () => {
    const git = {
      log: jest.fn(async () => ({ all: [{ hash: 'a', message: 'm' }] })),
    } as unknown as SimpleGit;

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
      } as unknown as SimpleGit;

      await getDiff(git, 'HEAD~1', 'HEAD', [], false, ['force-app'], testRepoRoot);

      expect(git.diff).toHaveBeenCalledWith(['HEAD~1..HEAD', '--', 'included-app']);
    });

    it('returns no changed files when all package directories are ignored', async () => {
      const git = {
        diff: jest.fn(),
        show: jest.fn(),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(
        git,
        'HEAD~1',
        'HEAD',
        [],
        false,
        ['force-app', 'included-app'],
        testRepoRoot
      );

      expect(files).toEqual([]);
    });

    it('queries commit diffs when filtering by commit', async () => {
      const git = {
        diff: jest.fn(async () => 'patch'),
      } as unknown as SimpleGit;

      const result = await getDiff(
        git,
        'HEAD~3',
        'HEAD',
        [{ hash: 'abcdef1', message: 'commit' }],
        true,
        ['force-app'],
        testRepoRoot
      );

      expect(result).toBe('patch');
      expect(git.diff).toHaveBeenCalledWith(['abcdef1^!', '--', 'included-app']);
    });

    it('returns empty diff when all package directories are ignored', async () => {
      const git = {
        diff: jest.fn(),
      } as unknown as SimpleGit;

      const result = await getDiff(git, 'HEAD~3', 'HEAD', [], false, ['force-app', 'included-app'], testRepoRoot);

      expect(result).toBe('');
    });

    it('returns changed files without commit filter', async () => {
      const git = {
        diff: jest.fn(async () => 'included-app/main/changed.cls\n'),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(git, 'HEAD~3', 'HEAD', [], false, ['force-app'], testRepoRoot);

      expect(files).toEqual(['included-app/main/changed.cls']);
    });

    it('filters commit show output correctly', async () => {
      const git = {
        show: jest.fn(async () => 'force-app/x.cls\nincluded-app/x.cls\nother/x.cls'),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(
        git,
        'HEAD~3',
        'HEAD',
        [{ hash: 'abc', message: 'commit' }],
        true,
        undefined,
        testRepoRoot
      );

      expect(files).toEqual(['force-app/x.cls', 'included-app/x.cls']);
    });
    it('resolves repo root using git rev-parse', async () => {
      const git = {
        revparse: jest.fn(async () => ' /fake/repo/root\n'),
      } as unknown as SimpleGit;

      const root = await getRepoRoot(git);

      expect(root).toBe('/fake/repo/root');
      expect(git.revparse).toHaveBeenCalledWith(['--show-toplevel']);
    });
    it('returns empty array when sfdx-project.json is missing', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-no-sfdx-'));

      const git = {
        revparse: jest.fn(async () => tmpRoot),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(git, 'HEAD~1', 'HEAD', [], false, undefined, tmpRoot);

      expect(files).toEqual([]);

      await rm(tmpRoot, { recursive: true, force: true });
    });
    it('returns empty results when packageDirectories is empty', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-empty-packages-'));

      await writeFile(join(tmpRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [] }), 'utf8');

      const git = {
        revparse: jest.fn(async () => tmpRoot),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(git, 'HEAD~1', 'HEAD', [], false, undefined, tmpRoot);

      expect(files).toEqual([]);

      await rm(tmpRoot, { recursive: true, force: true });
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
      } as unknown as SimpleGit;

      const res = await getCommits(git, 'a', 'b');

      expect(res).toEqual([{ hash: 'abc', message: 'msg' }]);
      expect(git.log).toHaveBeenCalledWith({ from: 'a', to: 'b' });
    });
    it('filterCommits returns unfiltered commits when messageFilter is undefined', () => {
      const commits = [
        { hash: '1', message: 'hello' },
        { hash: '2', message: 'world' },
      ];

      expect(filterCommits(commits, undefined)).toEqual(commits);
    });
    it('uses repoRootOverride instead of git rev-parse', async () => {
      const git = {
        diff: jest.fn(async () => ''),
        show: jest.fn(async () => ''),
        revparse: jest.fn(async () => '/SHOULD-NOT-BE-CALLED'),
      } as unknown as SimpleGit;

      const override = '/custom/root';

      await getDiff(git, 'a', 'b', [], false, undefined, override);

      expect(git.revparse).not.toHaveBeenCalled();
    });
    it('returns empty diff and files when repo has no sfdx-project.json', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'sgai-empty-'));

      const git = {
        revparse: jest.fn(async () => tmp),
        diff: jest.fn(),
        show: jest.fn(),
      } as unknown as SimpleGit;

      const diff = await getDiff(git, 'a', 'b', [], false, undefined, tmp);
      const files = await getChangedFiles(git, 'a', 'b', [], false, undefined, tmp);

      expect(diff).toBe('');
      expect(files).toEqual([]);

      await rm(tmp, { recursive: true, force: true });
    });
    it('creates git client using default cwd when none provided', () => {
      const client = createGitClient();
      expect(client).toBeDefined();
    });
    it('creates git client using default cwd when none provided', () => {
      const client = createGitClient();
      expect(client).toBeDefined();
    });
    it('getDiff returns empty string when package paths resolve to empty via ignore filter', async () => {
      const git = {
        revparse: jest.fn(async () => '/repo'),
        diff: jest.fn(),
      } as unknown as SimpleGit;

      const result = await getDiff(git, 'a', 'b', [], false, ['force-app', 'included-app'], '/repo');

      expect(result).toBe('');
      expect(git.diff).not.toHaveBeenCalled();
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
      } as unknown as SimpleGit;

      const result = await getDiff(
        git,
        'a',
        'b',
        [
          { hash: 'c1', message: 'm1' },
          { hash: 'c2', message: 'm2' },
        ],
        true,
        undefined,
        tmpRoot
      );

      expect(result).toContain('patch-c1^!');
      expect(result).toContain('patch-c2^!');

      await rm(tmpRoot, { recursive: true, force: true });
    });

    it('returns empty package list when sfdx-project.json is invalid JSON', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'sgai-bad-json-'));

      await writeFile(join(tmp, 'sfdx-project.json'), 'NOT VALID JSON', 'utf8');

      const git = {
        revparse: jest.fn(async () => tmp),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(git, 'a', 'b', [], false, undefined, tmp);

      expect(files).toEqual([]);
    });
    it('returns empty package list when sfdx-project.json cannot be read', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'sgai-no-file-'));

      const git = {
        revparse: jest.fn(async () => tmp),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(git, 'a', 'b', [], false, undefined, tmp);

      expect(files).toEqual([]);
    });
    it('covers invalid JSON parse branch explicitly', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'sgai-jsonfail-'));

      await writeFile(join(tmp, 'sfdx-project.json'), '{ INVALID JSON', 'utf8');

      const git = {
        revparse: jest.fn(async () => tmp),
      } as unknown as SimpleGit;

      const files = await getChangedFiles(git, 'a', 'b', [], false, undefined, tmp);

      expect(files).toEqual([]);
    });
    it('covers empty string messageFilter branch', () => {
      const commits = [
        { hash: '1', message: 'hello' },
        { hash: '2', message: 'world' },
      ];

      expect(filterCommits(commits, '')).toEqual(commits);
    });
    it('covers regex special characters in filterCommits', () => {
      const commits = [
        { hash: '1', message: 'fix (critical)' },
        { hash: '2', message: 'add feature' },
      ];

      expect(filterCommits(commits, '(critical)')).toEqual([{ hash: '1', message: 'fix (critical)' }]);
    });
  });
});
