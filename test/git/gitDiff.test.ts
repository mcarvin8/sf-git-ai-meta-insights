import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SimpleGit } from 'simple-git';
import { describe, it, expect, jest } from '@jest/globals';

import { getDiffSummary, parseDiffSummary } from '../../src/git/gitDiff.js';

describe('parseDiffSummary', () => {
  it('aggregates multiple lines for the same path (merge branch)', () => {
    const out = parseDiffSummary(
      'M\t1\t2\tforce-app/Foo.cls\n' + 'M\t3\t4\tforce-app/Foo.cls\n' + 'M\t0\t0\tforce-app/Bar.cls\n'
    );
    expect(out.totalFiles).toBe(2);
    const foo = out.files.find((f) => f.path === 'force-app/Foo.cls');
    expect(foo).toEqual(
      expect.objectContaining({
        path: 'force-app/Foo.cls',
        status: 'modified',
        additions: 4,
        deletions: 6,
      })
    );
  });

  it('parses rename lines and skips rows with unexpected column count', () => {
    const out = parseDiffSummary(
      'R100\t0\t0\tforce-app/Old.cls\tforce-app/New.cls\n' + 'M\t1\t2\tforce-app/X.cls\n' + 'M\t1\t2\ta\tb\tc\td\n'
    );
    expect(out.totalFiles).toBe(2);
    const renamed = out.files.find((f) => f.path === 'force-app/New.cls');
    expect(renamed).toMatchObject({
      path: 'force-app/New.cls',
      status: 'renamed',
      oldPath: 'force-app/Old.cls',
      newPath: 'force-app/New.cls',
    });
  });
});

describe('getDiffSummary merge and status coverage', () => {
  it('merges name-status across commits when the same path gains oldPath (M then R)', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-diff-merge-path-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      'utf8'
    );

    const git = {
      diff: jest.fn(async (args: string[]) => {
        const range = args[1];
        if (args.includes('--name-status')) {
          if (range === 'c1^!') return 'M\tforce-app/X.cls\n';
          if (range === 'c2^!') return 'R100\tforce-app/Old.cls\tforce-app/X.cls\n';
        }
        if (args.includes('--numstat')) {
          if (range === 'c1^!') return '1\t1\tforce-app/X.cls\n';
          if (range === 'c2^!') return '0\t0\tforce-app/{Old.cls => X.cls}\n';
        }
        return '';
      }),
      revparse: jest.fn(async () => tmpRoot),
    } as unknown as SimpleGit;

    const summary = await getDiffSummary(
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

    const x = summary.files.find((f) => f.path === 'force-app/X.cls');
    expect(x).toMatchObject({
      path: 'force-app/X.cls',
      oldPath: 'force-app/Old.cls',
      status: 'renamed',
    });

    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('covers deleted, copied, type-changed, and unknown name-status rows', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-diff-statuses-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      'utf8'
    );

    const git = {
      diff: jest.fn(async (args: string[]) => {
        if (args.includes('--name-status')) {
          return (
            'D\tforce-app/Gone.cls\n' +
            'C100\tforce-app/Src.cls\tforce-app/Copy.cls\n' +
            'T100\tforce-app/Twisted.cls\n' +
            'U\tforce-app/Unmerged.cls\n' +
            'R100\tincomplete-only-old\n'
          );
        }
        if (args.includes('--numstat')) {
          return (
            '-\t-\tforce-app/Gone.cls\n' +
            '2\t2\tforce-app/{Src.cls => Copy.cls}\n' +
            '1\t0\tforce-app/Twisted.cls\n' +
            '0\t0\tforce-app/Unmerged.cls\n'
          );
        }
        return '';
      }),
      revparse: jest.fn(async () => tmpRoot),
    } as unknown as SimpleGit;

    const summary = await getDiffSummary(git, 'HEAD~1', 'HEAD', [], false, undefined, tmpRoot);

    expect(summary.files.map((f) => f.path).sort()).toEqual(
      ['force-app/Copy.cls', 'force-app/Gone.cls', 'force-app/Twisted.cls', 'force-app/Unmerged.cls'].sort()
    );

    expect(summary.files.find((f) => f.path === 'force-app/Gone.cls')).toMatchObject({
      status: 'deleted',
      additions: 0,
      deletions: 0,
    });
    expect(summary.files.find((f) => f.path === 'force-app/Copy.cls')).toMatchObject({
      status: 'copied',
      additions: 2,
      deletions: 2,
      oldPath: 'force-app/Src.cls',
    });
    expect(summary.files.find((f) => f.path === 'force-app/Twisted.cls')).toMatchObject({
      status: 'type-changed',
      additions: 1,
      deletions: 0,
    });
    expect(summary.files.find((f) => f.path === 'force-app/Unmerged.cls')).toMatchObject({
      status: 'unknown',
      additions: 0,
      deletions: 0,
    });

    await rm(tmpRoot, { recursive: true, force: true });
  });
});
