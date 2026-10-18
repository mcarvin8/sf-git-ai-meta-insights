import {
  fetchBestReferenceDoc,
  type ReferenceDoc,
  type ReferenceDocsOptions,
  searchReferenceDocs,
} from '../ai/referenceDocs.js';
import { BROWSER_INSTALL_HINT, findBrowserExecutable, renderReleaseNotes } from './releaseNotesBrowser.js';
import type { GitClient } from './sfdxPackagePaths.js';

/** At most this many releases are looked up when `sourceApiVersion` jumps across several releases. */
export const MAX_RELEASE_NOTE_RELEASES = 3;

/**
 * help.salesforce.com often answers automated retrieval with a short banner or cookie notice
 * instead of the article, so release notes need more text than an explicit URL to count.
 */
export const MIN_RELEASE_NOTE_CHARS = 1000;

const SEASONS = ['Spring', 'Summer', 'Winter'] as const;

export type SalesforceRelease = {
  apiVersion: number;
  /** Release number used by help.salesforce.com, e.g. 256 for Summer '25. */
  release: number;
  /** Human-readable name, e.g. "Summer '25". */
  name: string;
  /** Metadata API section of the release notes for this release. */
  url: string;
  /**
   * Equivalent spellings of `url`. Parallel caches each URL string separately and some copies are
   * only a cookie banner, so asking for all of them in one call markedly improves the hit rate.
   */
  urlVariants: string[];
};

/** Map a major API version to its Salesforce release (API 60.0 = Spring '24 = release 248). */
export function salesforceReleaseForApiVersion(apiVersion: number): SalesforceRelease {
  const season = SEASONS[((apiVersion % 3) + 3) % 3];
  const year = String(24 + Math.floor((apiVersion - 60) / 3) + (season === 'Winter' ? 1 : 0)).padStart(2, '0');
  const release = apiVersion * 2 + 128;
  const urlFor = (language: string) =>
    `https://help.salesforce.com/s/articleView?id=release-notes.rn_api_meta.htm${language}&release=${release}&type=5`;
  return {
    apiVersion,
    release,
    name: `${season} '${year}`,
    url: urlFor('&language=en_US'),
    urlVariants: [urlFor('&language=en_US'), urlFor('&language=en'), urlFor('')],
  };
}

/** Parse the major version from an `sfdx-project.json` body's `sourceApiVersion`, if present. */
export function parseSourceApiVersion(projectJson: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson);
  } catch {
    return undefined;
  }
  const raw = (parsed as { sourceApiVersion?: unknown } | null)?.sourceApiVersion;
  const match = typeof raw === 'string' ? /^\s*(\d+)(?:\.\d+)?\s*$/.exec(raw) : null;
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** Read `sourceApiVersion` from `sfdx-project.json` at the repository root as of `rev`. */
export async function readSourceApiVersionAt(git: GitClient, rev: string): Promise<number | undefined> {
  try {
    const { content } = await git.readFileAt(rev, 'sfdx-project.json');
    return parseSourceApiVersion(new TextDecoder().decode(content));
  } catch {
    return undefined;
  }
}

/**
 * API versions whose release notes apply to the range: the `to` version, plus every version the
 * range upgraded through when `sourceApiVersion` increased (capped to the most recent releases).
 */
export function releaseNoteApiVersions(fromVersion: number | undefined, toVersion: number | undefined): number[] {
  if (toVersion === undefined) return [];
  const start = fromVersion !== undefined && fromVersion < toVersion ? fromVersion + 1 : toVersion;
  const versions: number[] = [];
  for (let v = Math.max(start, toVersion - MAX_RELEASE_NOTE_RELEASES + 1); v <= toVersion; v++) {
    versions.push(v);
  }
  return versions;
}

const mentionsMetadata = (text: string): boolean => /metadata/i.test(text);

/**
 * Retrieve Metadata API release notes for one release through Parallel, trying every spelling of
 * the release's page in one `web_fetch` call, then a search restricted to help.salesforce.com pages
 * carrying this release number. Parallel often returns only a cookie banner for these JavaScript
 * pages, so this is the fallback when no browser is available. Returns [] when nothing is usable.
 */
export async function fetchReleaseNotes(
  release: SalesforceRelease,
  options: ReferenceDocsOptions = {},
): Promise<ReferenceDoc[]> {
  const docsOptions = { minChars: MIN_RELEASE_NOTE_CHARS, acceptText: mentionsMetadata, ...options };
  const attempts: Array<() => Promise<ReferenceDoc[]>> = [
    () => fetchBestReferenceDoc(release.urlVariants, docsOptions),
    () =>
      searchReferenceDocs(
        `Salesforce ${release.name} Release Notes (API version ${release.apiVersion}.0): new, changed, and deprecated Metadata API types and fields`,
        [
          `site:help.salesforce.com ${release.name} release notes Metadata API`,
          `${release.name} new and changed metadata types API version ${release.apiVersion}.0`,
        ],
        (url) =>
          url.hostname === 'help.salesforce.com' &&
          url.searchParams.get('release') === String(release.release) &&
          (url.searchParams.get('id') ?? '').startsWith('release-notes.'),
        docsOptions,
      ),
  ];
  for (const attempt of attempts) {
    try {
      const docs = await attempt();
      if (docs.length > 0) return docs;
    } catch {
      // Try the next source.
    }
  }
  return [];
}

export type ReleaseNotesDeps = {
  findBrowser?: typeof findBrowserExecutable;
  render?: typeof renderReleaseNotes;
  fetchViaParallel?: typeof fetchReleaseNotes;
};

/**
 * Retrieve release notes for several releases. help.salesforce.com renders its articles with
 * JavaScript, so a headless Chromium browser (through puppeteer-core) is the reliable source; any
 * release it cannot render falls back to Parallel. Without a browser, every release uses Parallel
 * and a warning explains how to install one.
 */
export async function fetchReleaseNotesForReleases(
  releases: SalesforceRelease[],
  options: { charBudget: number; log: (message: string) => void },
  deps: ReleaseNotesDeps = {},
): Promise<ReferenceDoc[][]> {
  if (releases.length === 0) return [];
  const fetchViaParallel = deps.fetchViaParallel ?? fetchReleaseNotes;
  const executablePath = await (deps.findBrowser ?? findBrowserExecutable)();
  let rendered: ReferenceDoc[][] = releases.map(() => []);
  if (executablePath) {
    try {
      rendered = await (deps.render ?? renderReleaseNotes)(releases, {
        executablePath,
        charBudget: options.charBudget,
        minChars: MIN_RELEASE_NOTE_CHARS,
      });
    } catch (err) {
      options.log(
        `Warning: could not start the browser at ${executablePath} to render release notes (${err instanceof Error ? err.message : String(err)}); using Parallel instead.`,
      );
    }
  } else {
    options.log(
      `Warning: no Chrome or Chromium browser found to render Salesforce release notes, so they are fetched through Parallel, which often cannot read them. Install one with \`${BROWSER_INSTALL_HINT}\` or set PUPPETEER_EXECUTABLE_PATH.`,
    );
  }
  return Promise.all(
    releases.map((release, i) =>
      rendered[i]?.length ? rendered[i] : fetchViaParallel(release, { charBudget: options.charBudget }),
    ),
  );
}
