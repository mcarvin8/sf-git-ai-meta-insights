import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/salesforce/releaseNotesBrowser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/salesforce/releaseNotesBrowser.js')>()),
  findBrowserExecutable: vi.fn(async () => '/usr/bin/chromium'),
  renderReleaseNotes: vi.fn(async (releases: Array<{ url: string }>) =>
    releases.map((r) => [{ url: r.url, excerpts: 'default render', truncated: false }]),
  ),
}));

import {
  fetchReleaseNotes,
  fetchReleaseNotesForReleases,
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
    const page = 'https://help.salesforce.com/s/articleView?id=release-notes.rn_api_meta.htm';
    expect(salesforceReleaseForApiVersion(apiVersion)).toEqual({
      apiVersion,
      release,
      name,
      url: `${page}&language=en_US&release=${release}&type=5`,
      urlVariants: [
        `${page}&language=en_US&release=${release}&type=5`,
        `${page}&language=en&release=${release}&type=5`,
        `${page}&release=${release}&type=5`,
      ],
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
  const usable = 'Use the new field on the Flow metadata type. Available in API version 64.0. '.repeat(20);
  const banner = 'Agentforce is temporarily unavailable. '.repeat(10);
  const searchMatch = 'https://help.salesforce.com/s/articleView?id=release-notes.rn_change_log.htm&release=256&type=5';

  type Call = { name: string; args: Record<string, unknown> };

  /** Fake Parallel that answers each source from a table and records the calls. */
  function parallel(pages: Record<string, string>, search: Array<{ url: string; text: string }> = []) {
    const calls: Call[] = [];
    const { fetchImpl } = mockParallelMcp((name, args) => {
      calls.push({ name, args });
      if (name === 'web_search') {
        return structured({ results: search.map(({ url, text }) => ({ url, excerpts: [text] })) });
      }
      const urls = args.urls as string[];
      return structured({
        results: urls.filter((url) => url in pages).map((url) => ({ url, excerpts: [pages[url]] })),
        errors: [],
      });
    });
    return { calls, fetchImpl };
  }

  it('asks for every page spelling in one call and returns the longest usable copy', async () => {
    const [enUs, en, plain] = release.urlVariants;
    const { calls, fetchImpl } = parallel({ [enUs]: banner, [en]: usable, [plain]: usable.slice(0, 1200) });

    const docs = await fetchReleaseNotes(release, { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0].args.urls).toEqual(release.urlVariants);
    expect(docs).toEqual([{ url: en, excerpts: usable.trim(), truncated: false }]);
  });

  it('rejects page text that never mentions metadata', async () => {
    const { calls, fetchImpl } = parallel({ [release.url]: 'Cookie Consent Manager. '.repeat(60) });
    await expect(fetchReleaseNotes(release, { fetchImpl })).resolves.toEqual([]);
    expect(calls.map((c) => c.name)).toEqual(['web_fetch', 'web_search']);
  });

  it('falls back to a search restricted to this release on help.salesforce.com', async () => {
    const help = 'https://help.salesforce.com/s/articleView';
    const { calls, fetchImpl } = parallel({}, [
      { url: `${help}?id=release-notes.rn_api_meta.htm&release=254&type=5`, text: usable },
      { url: `${help}?id=000354473&release=256&type=1`, text: usable },
      { url: `${help}?release=256`, text: usable },
      { url: 'https://example.com/?id=release-notes.x&release=256', text: usable },
      { url: `${help}?id=release-notes.rn_api_meta.htm&release=256&type=6`, text: 'No mention. '.repeat(100) },
      { url: searchMatch, text: usable },
    ]);

    const docs = await fetchReleaseNotes(release, { fetchImpl });

    expect(docs.map((d) => d.url)).toEqual([searchMatch]);
    expect(calls[1]).toEqual({
      name: 'web_search',
      args: {
        objective:
          "Salesforce Summer '25 Release Notes (API version 64.0): new, changed, and deprecated Metadata API types and fields",
        search_queries: [
          "site:help.salesforce.com Summer '25 release notes Metadata API",
          "Summer '25 new and changed metadata types API version 64.0",
        ],
        session_id: expect.any(String),
      },
    });
  });

  it('applies the release-note minimum to every source', async () => {
    const short = `metadata ${'x'.repeat(MIN_RELEASE_NOTE_CHARS - 30)} API version 64.0`;
    expect(short.length).toBeLessThan(MIN_RELEASE_NOTE_CHARS);
    const { fetchImpl } = parallel({ [release.url]: short }, [{ url: searchMatch, text: short }]);
    await expect(fetchReleaseNotes(release, { fetchImpl })).resolves.toEqual([]);
  });

  it('lets callers override the minimum length and budget', async () => {
    const { fetchImpl } = parallel({ [release.url]: `metadata ${'y'.repeat(300)}` });
    const docs = await fetchReleaseNotes(release, { fetchImpl, minChars: 300, charBudget: 50 });
    expect(docs).toEqual([{ url: release.url, excerpts: `metadata ${'y'.repeat(41)}`, truncated: true }]);
  });

  it('moves on to the next source when one fails, and returns [] when all fail', async () => {
    let attempt = 0;
    const { fetchImpl: base } = parallel({}, [{ url: searchMatch, text: usable }]);
    const flaky = async (url: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      if (body.method === 'tools/call' && ++attempt <= 1) return new Response('busy', { status: 429 });
      return base(url, init);
    };
    await expect(fetchReleaseNotes(release, { fetchImpl: flaky })).resolves.toHaveLength(1);

    await expect(
      fetchReleaseNotes(release, { fetchImpl: () => Promise.reject(new Error('offline')) }),
    ).resolves.toEqual([]);
  });
});

describe('fetchReleaseNotesForReleases', () => {
  const releases = [salesforceReleaseForApiVersion(64), salesforceReleaseForApiVersion(65)];
  const rendered = (url: string) => [{ url, excerpts: 'rendered', truncated: false }];
  const viaParallel = (url: string) => [{ url, excerpts: 'parallel', truncated: false }];

  it('does nothing for no releases', async () => {
    const findBrowser = vi.fn();
    await expect(fetchReleaseNotesForReleases([], { charBudget: 100, log: vi.fn() }, { findBrowser })).resolves.toEqual(
      [],
    );
    expect(findBrowser).not.toHaveBeenCalled();
  });

  it('renders with the browser and uses Parallel only for releases it could not render', async () => {
    const render = vi.fn(async () => [rendered(releases[0].url), []]);
    const fetchViaParallel = vi.fn(async (release: { url: string }) => viaParallel(release.url));
    const log = vi.fn();

    const docs = await fetchReleaseNotesForReleases(
      releases,
      { charBudget: 500, log },
      { findBrowser: async () => '/usr/bin/chromium', render, fetchViaParallel },
    );

    expect(render).toHaveBeenCalledWith(releases, {
      executablePath: '/usr/bin/chromium',
      charBudget: 500,
      minChars: MIN_RELEASE_NOTE_CHARS,
    });
    expect(fetchViaParallel).toHaveBeenCalledTimes(1);
    expect(fetchViaParallel).toHaveBeenCalledWith(releases[1], { charBudget: 500 });
    expect(docs).toEqual([rendered(releases[0].url), viaParallel(releases[1].url)]);
    expect(log).not.toHaveBeenCalled();
  });

  it('falls back to Parallel with an install hint when no browser is found', async () => {
    const render = vi.fn();
    const fetchViaParallel = vi.fn(async (release: { url: string }) => viaParallel(release.url));
    const log = vi.fn();

    const docs = await fetchReleaseNotesForReleases(
      releases,
      { charBudget: 500, log },
      { findBrowser: async () => undefined, render, fetchViaParallel },
    );

    expect(render).not.toHaveBeenCalled();
    expect(docs).toEqual(releases.map((r) => viaParallel(r.url)));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('no Chrome or Chromium browser found');
    expect(log.mock.calls[0][0]).toContain(
      '`npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/puppeteer`',
    );
    expect(log.mock.calls[0][0]).toContain('PUPPETEER_EXECUTABLE_PATH');
  });

  it('falls back to Parallel with a warning when the browser cannot start', async () => {
    const fetchViaParallel = vi.fn(async (release: { url: string }) => viaParallel(release.url));
    const log = vi.fn();

    const docs = await fetchReleaseNotesForReleases(
      releases,
      { charBudget: 500, log },
      {
        findBrowser: async () => '/opt/chrome',
        render: async () => Promise.reject(new Error('missing libnss3')),
        fetchViaParallel,
      },
    );

    expect(docs).toEqual(releases.map((r) => viaParallel(r.url)));
    expect(log).toHaveBeenCalledWith(
      'Warning: could not start the browser at /opt/chrome to render release notes (missing libnss3); using Parallel instead.',
    );

    log.mockClear();
    await fetchReleaseNotesForReleases(
      releases,
      { charBudget: 500, log },
      { findBrowser: async () => '/opt/chrome', render: async () => Promise.reject('boom'), fetchViaParallel },
    );
    expect(log.mock.calls[0][0]).toContain('(boom)');
  });

  it('uses the real browser lookup and renderer by default', async () => {
    const docs = await fetchReleaseNotesForReleases(releases, { charBudget: 300, log: vi.fn() });
    expect(docs).toEqual(releases.map((r) => [{ url: r.url, excerpts: 'default render', truncated: false }]));
  });
});
