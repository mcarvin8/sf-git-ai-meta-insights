import { describe, expect, it, vi } from 'vitest';

import {
  fetchReleaseNotes,
  MAX_RELEASE_NOTE_RELEASES,
  MIN_RELEASE_NOTE_CHARS,
  parseSourceApiVersion,
  readSourceApiVersionAt,
  releaseNoteApiVersions,
  salesforceReleaseForApiVersion,
} from '../../src/salesforce/releaseNotes.js';
import type { GitClient } from '../../src/salesforce/sfdxPackagePaths.js';
import { mockParallelMcp, structured } from '../ai/parallelMcp.fixture.js';

describe('salesforceReleaseForApiVersion', () => {
  it.each([
    [50, 228, "Winter '21"],
    [58, 244, "Summer '23"],
    [59, 246, "Winter '24"],
    [60, 248, "Spring '24"],
    [61, 250, "Summer '24"],
    [62, 252, "Winter '25"],
    [63, 254, "Spring '25"],
    [64, 256, "Summer '25"],
    [65, 258, "Winter '26"],
    [66, 260, "Spring '26"],
  ])('maps API %i to release %i (%s)', (apiVersion, release, name) => {
    expect(salesforceReleaseForApiVersion(apiVersion)).toEqual({
      apiVersion,
      release,
      name,
      url: `https://help.salesforce.com/s/articleView?id=release-notes.rn_api_meta.htm&language=en_US&release=${release}&type=5`,
    });
  });
});

describe('parseSourceApiVersion', () => {
  it.each([
    ['{"sourceApiVersion":"64.0"}', 64],
    ['{"sourceApiVersion":" 62 "}', 62],
    ['{"sourceApiVersion":"61.5"}', 61],
  ])('parses %s', (json, expected) => {
    expect(parseSourceApiVersion(json)).toBe(expected);
  });

  it.each([
    'not json',
    'null',
    '{}',
    '{"sourceApiVersion":64}',
    '{"sourceApiVersion":"v64"}',
    '{"sourceApiVersion":"64.0.1"}',
    '{"sourceApiVersion":""}',
  ])('returns undefined for %s', (json) => {
    expect(parseSourceApiVersion(json)).toBeUndefined();
  });
});

describe('readSourceApiVersionAt', () => {
  it('reads sfdx-project.json at the given revision', async () => {
    const readFileAt = vi.fn(async () => ({ content: new TextEncoder().encode('{"sourceApiVersion":"65.0"}') }));
    const git = { readFileAt } as unknown as GitClient;
    await expect(readSourceApiVersionAt(git, 'v1.0')).resolves.toBe(65);
    expect(readFileAt).toHaveBeenCalledWith('v1.0', 'sfdx-project.json');
  });

  it('returns undefined when the file is missing at that revision', async () => {
    const git = {
      readFileAt: vi.fn(async () => Promise.reject(new Error('PATH_NOT_IN_TREE'))),
    } as unknown as GitClient;
    await expect(readSourceApiVersionAt(git, 'HEAD')).resolves.toBeUndefined();
  });
});

describe('releaseNoteApiVersions', () => {
  it('returns nothing without a target version', () => {
    expect(releaseNoteApiVersions(64, undefined)).toEqual([]);
    expect(releaseNoteApiVersions(undefined, undefined)).toEqual([]);
  });

  it('returns only the target version when unchanged, unknown, or downgraded', () => {
    expect(releaseNoteApiVersions(64, 64)).toEqual([64]);
    expect(releaseNoteApiVersions(undefined, 64)).toEqual([64]);
    expect(releaseNoteApiVersions(65, 64)).toEqual([64]);
  });

  it('returns every upgraded-through version, capped to the most recent releases', () => {
    expect(releaseNoteApiVersions(63, 64)).toEqual([64]);
    expect(releaseNoteApiVersions(62, 65)).toEqual([63, 64, 65]);
    expect(releaseNoteApiVersions(55, 65)).toEqual([63, 64, 65]);
    expect(MAX_RELEASE_NOTE_RELEASES).toBe(3);
  });
});

describe('fetchReleaseNotes', () => {
  const release = salesforceReleaseForApiVersion(64);
  const usable = 'Use the new field on the Flow metadata type. '.repeat(30);

  it('returns the release page when web_fetch yields enough text', async () => {
    const calls: string[] = [];
    const { fetchImpl } = mockParallelMcp((name) => {
      calls.push(name);
      return structured({ results: [{ url: release.url, title: 'Metadata API', excerpts: [usable] }], errors: [] });
    });

    const docs = await fetchReleaseNotes(release, { fetchImpl });

    expect(calls).toEqual(['web_fetch']);
    expect(docs).toEqual([{ url: release.url, title: 'Metadata API', excerpts: usable.trim(), truncated: false }]);
  });

  it('falls back to a release-scoped search when the page is only a banner', async () => {
    const banner = 'Agentforce is temporarily unavailable. '.repeat(10);
    expect(banner.trim().length).toBeLessThan(MIN_RELEASE_NOTE_CHARS);
    const searches: Array<Record<string, unknown>> = [];
    const otherRelease =
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_api_meta.htm&release=254&type=5';
    const wrongId = 'https://help.salesforce.com/s/articleView?id=000354473&release=256&type=1';
    const noId = 'https://help.salesforce.com/s/articleView?release=256';
    const otherHost = 'https://example.com/?id=release-notes.x&release=256';
    const match = 'https://help.salesforce.com/s/articleView?id=release-notes.rn_change_log.htm&release=256&type=5';
    const { fetchImpl } = mockParallelMcp((name, args) => {
      if (name === 'web_fetch') return structured({ results: [{ url: release.url, excerpts: [banner] }] });
      searches.push(args);
      return structured({
        results: [otherRelease, wrongId, noId, otherHost, match].map((url) => ({ url, excerpts: [usable] })),
      });
    });

    const docs = await fetchReleaseNotes(release, { fetchImpl });

    expect(docs.map((d) => d.url)).toEqual([match]);
    expect(searches).toEqual([
      {
        objective:
          "Salesforce Summer '25 Release Notes (API version 64.0): new, changed, and deprecated Metadata API types and fields",
        search_queries: [
          "site:help.salesforce.com Summer '25 release notes Metadata API",
          "Summer '25 new and changed metadata types API version 64.0",
        ],
      },
    ]);
  });

  it('applies the release-note minimum to search results too', async () => {
    const short = 'x'.repeat(MIN_RELEASE_NOTE_CHARS - 1);
    const { fetchImpl } = mockParallelMcp((name) =>
      name === 'web_fetch'
        ? structured({ results: [] })
        : structured({
            results: [{ url: release.url, excerpts: [short] }],
          }),
    );
    await expect(fetchReleaseNotes(release, { fetchImpl })).resolves.toEqual([]);
  });

  it('lets callers override the minimum length', async () => {
    const { fetchImpl } = mockParallelMcp(() =>
      structured({ results: [{ url: release.url, excerpts: ['y'.repeat(300)] }] }),
    );
    await expect(fetchReleaseNotes(release, { fetchImpl, minChars: 300 })).resolves.toHaveLength(1);
  });

  it('returns [] when both retrieval paths fail', async () => {
    await expect(
      fetchReleaseNotes(release, { fetchImpl: () => Promise.reject(new Error('offline')) }),
    ).resolves.toEqual([]);
  });
});
