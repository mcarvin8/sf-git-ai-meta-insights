import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, jest } from '@jest/globals';
import type { DiffFileSummary } from '@mcarvin/smart-diff';
import { getDiffSummary, getRepoRoot } from '@mcarvin/smart-diff';

type GitClient = Parameters<typeof getRepoRoot>[0];

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
    } as unknown as GitClient;

    const summary = await getDiffSummary(
      git,
      'a',
      'b',
      [
        { hash: 'c1', message: 'm1' },
        { hash: 'c2', message: 'm2' },
      ],
      true,
      { includeFolders: ['force-app'] },
      tmpRoot
    );

    const x = summary.files.find((f: DiffFileSummary) => f.path === 'force-app/X.cls');
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
    } as unknown as GitClient;

    const summary = await getDiffSummary(git, 'HEAD~1', 'HEAD', [], false, { includeFolders: ['force-app'] }, tmpRoot);

    expect(summary.files.map((f: DiffFileSummary) => f.path).sort()).toEqual(
      ['force-app/Copy.cls', 'force-app/Gone.cls', 'force-app/Twisted.cls', 'force-app/Unmerged.cls'].sort()
    );

    expect(summary.files.find((f: DiffFileSummary) => f.path === 'force-app/Gone.cls')).toMatchObject({
      status: 'deleted',
      additions: 0,
      deletions: 0,
    });
    expect(summary.files.find((f: DiffFileSummary) => f.path === 'force-app/Copy.cls')).toMatchObject({
      status: 'copied',
      additions: 2,
      deletions: 2,
      oldPath: 'force-app/Src.cls',
    });
    expect(summary.files.find((f: DiffFileSummary) => f.path === 'force-app/Twisted.cls')).toMatchObject({
      status: 'type-changed',
      additions: 1,
      deletions: 0,
    });
    expect(summary.files.find((f: DiffFileSummary) => f.path === 'force-app/Unmerged.cls')).toMatchObject({
      status: 'unknown',
      additions: 0,
      deletions: 0,
    });

    await rm(tmpRoot, { recursive: true, force: true });
  });
});
