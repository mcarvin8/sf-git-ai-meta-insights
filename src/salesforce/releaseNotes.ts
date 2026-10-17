import {
  fetchReferenceDocs,
  type ReferenceDoc,
  type ReferenceDocsOptions,
  searchReferenceDocs,
} from '../ai/referenceDocs.js';
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
};

/** Map a major API version to its Salesforce release (API 60.0 = Spring '24 = release 248). */
export function salesforceReleaseForApiVersion(apiVersion: number): SalesforceRelease {
  const season = SEASONS[((apiVersion % 3) + 3) % 3];
  const year = 24 + Math.floor((apiVersion - 60) / 3) + (season === 'Winter' ? 1 : 0);
  const release = apiVersion * 2 + 128;
  return {
    apiVersion,
    release,
    name: `${season} '${String(year).padStart(2, '0')}`,
    url: `https://help.salesforce.com/s/articleView?id=release-notes.rn_api_meta.htm&language=en_US&release=${release}&type=5`,
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

/**
 * Retrieve Metadata API release notes for one release. Tries the release-specific page first and
 * falls back to a search restricted to that release's help.salesforce.com pages, because the help
 * site often serves only a JavaScript shell to automated retrieval. Returns [] when nothing usable
 * is found so a flaky docs site never blocks the summary.
 */
export async function fetchReleaseNotes(
  release: SalesforceRelease,
  options: ReferenceDocsOptions = {},
): Promise<ReferenceDoc[]> {
  const docsOptions = { minChars: MIN_RELEASE_NOTE_CHARS, ...options };
  try {
    return await fetchReferenceDocs([release.url], docsOptions);
  } catch {
    // Fall through to search.
  }
  try {
    return await searchReferenceDocs(
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
    );
  } catch {
    return [];
  }
}
