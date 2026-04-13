import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, jest } from '@jest/globals';
import {
  type GitClient,
  getSalesforceMetadataIncludeFolders,
  normalizeRepoRelativeFolderPath,
  readPackageDirectoryRelativePaths,
} from '../../src/salesforce/sfdxPackagePaths.js';

describe('normalizeRepoRelativeFolderPath', () => {
  it('trims, strips leading slashes, and normalizes backslashes', () => {
    expect(normalizeRepoRelativeFolderPath('  foo\\bar  ')).toBe('foo/bar');
    expect(normalizeRepoRelativeFolderPath('//baz/qux')).toBe('baz/qux');
  });
});

describe('getSalesforceMetadataIncludeFolders', () => {
  it('uses git rev-parse when no repo root override is passed', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-git-root-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      'utf8'
    );
    const revparse = jest.fn(async () => tmpRoot);
    const git = { revparse } as unknown as GitClient;

    const paths = await getSalesforceMetadataIncludeFolders(git);

    expect(paths).toEqual(['force-app']);
    expect(revparse).toHaveBeenCalledWith(['--show-toplevel']);

    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('uses repoRootOverride without calling git rev-parse', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-override-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'pkg-a' }, { path: 'pkg-b' }] }),
      'utf8'
    );
    const revparse = jest.fn(async () => '/SHOULD-NOT-BE-CALLED');
    const git = { revparse } as unknown as GitClient;

    const paths = await getSalesforceMetadataIncludeFolders(git, ['pkg-a'], tmpRoot);

    expect(paths).toEqual(['pkg-b']);
    expect(revparse).not.toHaveBeenCalled();

    await rm(tmpRoot, { recursive: true, force: true });
  });
});

describe('readPackageDirectoryRelativePaths', () => {
  it('returns an empty list when sfdx-project.json is missing', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-no-sfdx-'));
    const paths = await readPackageDirectoryRelativePaths(tmpRoot);
    expect(paths).toEqual([]);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns an empty list when packageDirectories is empty', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-empty-packages-'));
    await writeFile(join(tmpRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [] }), 'utf8');
    const paths = await readPackageDirectoryRelativePaths(tmpRoot);
    expect(paths).toEqual([]);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns an empty list when sfdx-project.json is invalid JSON', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'sgai-bad-json-'));
    await writeFile(join(tmp, 'sfdx-project.json'), 'NOT VALID JSON', 'utf8');
    const paths = await readPackageDirectoryRelativePaths(tmp);
    expect(paths).toEqual([]);
    await rm(tmp, { recursive: true, force: true });
  });

  it('normalizes package directory paths relative to the repo root', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-pkg-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      'utf8'
    );
    const paths = await readPackageDirectoryRelativePaths(tmpRoot);
    expect(paths).toEqual(['force-app']);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('drops package directories that match exclude patterns', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sgai-excl-'));
    await writeFile(
      join(tmpRoot, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'force-app' }, { path: 'unpackaged' }],
      }),
      'utf8'
    );
    const paths = await readPackageDirectoryRelativePaths(tmpRoot, ['force-app']);
    expect(paths).toEqual(['unpackaged']);
    await rm(tmpRoot, { recursive: true, force: true });
  });
});
