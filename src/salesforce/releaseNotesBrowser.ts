import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ReferenceDoc } from '../ai/referenceDocs.js';

/** Environment variables naming a Chrome or Chromium executable, checked in order. */
export const BROWSER_PATH_ENVS = ['PUPPETEER_EXECUTABLE_PATH', 'CHROME_PATH'] as const;

/** Where `npx @puppeteer/browsers install chrome-headless-shell@stable --path <dir>` is looked for. */
export const PUPPETEER_CACHE_DIR_ENV = 'PUPPETEER_CACHE_DIR';

/** Install command suggested when no browser is found. */
export const BROWSER_INSTALL_HINT =
  'npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/puppeteer';

const NAVIGATION_TIMEOUT_MS = 60_000;
const ARTICLE_END_MARKER = 'DID THIS ARTICLE SOLVE YOUR ISSUE';
const ARTICLE_START = /new and changed metadata types/i;

/** Standard install locations for Chrome, Chromium, and Edge (all Chromium-based). */
export function standardBrowserPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(
      (root): root is string => typeof root === 'string' && root.length > 0,
    );
    return roots.flatMap((root) => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

export type BrowserDiscovery = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  /** Executables of browsers installed in a Puppeteer cache directory. */
  installedInCache?: (cacheDir: string) => Promise<string[]>;
};

async function puppeteerCacheExecutables(cacheDir: string): Promise<string[]> {
  if (!existsSync(cacheDir)) return [];
  const { getInstalledBrowsers } = await import('@puppeteer/browsers');
  const installed = await getInstalledBrowsers({ cacheDir });
  // Prefer the lightweight headless shell, then full Chrome, over other cached browsers.
  const rank = (browser: string) => ['chrome-headless-shell', 'chrome', 'chromium'].indexOf(browser);
  return installed
    .filter((b) => rank(b.browser) >= 0)
    .sort((a, b) => rank(a.browser) - rank(b.browser))
    .map((b) => b.executablePath);
}

/**
 * Find a Chromium-based browser to render release notes with: an explicit environment variable, then
 * a standard install (GitHub-hosted runners and developer machines have one), then a browser
 * installed into the Puppeteer cache (the usual CI container setup). Returns undefined when none.
 */
export async function findBrowserExecutable(discovery: BrowserDiscovery = {}): Promise<string | undefined> {
  const env = discovery.env ?? process.env;
  const exists = discovery.exists ?? existsSync;
  for (const name of BROWSER_PATH_ENVS) {
    const value = env[name]?.trim();
    if (value && exists(value)) return value;
  }
  const standard = standardBrowserPaths(discovery.platform ?? process.platform, env).find((path) => exists(path));
  if (standard) return standard;
  const cacheDir = env[PUPPETEER_CACHE_DIR_ENV]?.trim() || join(homedir(), '.cache', 'puppeteer');
  try {
    const cached = await (discovery.installedInCache ?? puppeteerCacheExecutables)(cacheDir);
    return cached.find((path) => exists(path));
  } catch {
    return undefined;
  }
}

/** Chrome flags for CI: containers usually run as root (no sandbox) with a small /dev/shm. */
export function browserLaunchArgs(
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
): string[] {
  const args: string[] = [];
  if (platform === 'linux') args.push('--disable-dev-shm-usage');
  if (uid === 0) args.push('--no-sandbox');
  return args;
}

export type ReleaseNotesTarget = {
  name: string;
  url: string;
};

const RELEASE_HEADING = /Salesforce (Spring|Summer|Winter)\s+['’](\d{2}) Release Notes/;

/**
 * Cut the Metadata API article out of a rendered help page's text and confirm it is the requested
 * release: the page must be the Metadata API article, its release-notes heading must name the
 * release, and the article must be long enough and mention metadata types.
 */
export function extractReleaseNotesArticle(
  pageText: string,
  pageTitle: string,
  release: ReleaseNotesTarget,
  minChars: number,
): string | undefined {
  if (!pageTitle.includes('Metadata API')) return undefined;
  const heading = RELEASE_HEADING.exec(pageText);
  if (!heading || `${heading[1]} '${heading[2]}` !== release.name) return undefined;

  const end = pageText.indexOf(ARTICLE_END_MARKER);
  let article = end >= 0 ? pageText.slice(0, end) : pageText;
  const start = article.search(ARTICLE_START);
  if (start >= 0) article = article.slice(start);
  article = article
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== 'Loading')
    .join('\n');

  if (article.length < minChars || !/metadata type/i.test(article)) return undefined;
  return article;
}

/** The parts of a Puppeteer page this module uses, so tests can supply a fake. */
export type RenderPage = {
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (request: InterceptedRequest) => void): unknown;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForFunction(expression: string, options: { timeout: number }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  close(): Promise<void>;
};
export type InterceptedRequest = {
  resourceType(): string;
  abort(): Promise<void>;
  continue(): Promise<void>;
};
export type RenderBrowser = { newPage(): Promise<RenderPage>; close(): Promise<void> };
export type LaunchBrowser = (options: {
  executablePath: string;
  headless: true | 'shell';
  args: string[];
}) => Promise<RenderBrowser>;

async function launchWithPuppeteer(options: Parameters<LaunchBrowser>[0]): Promise<RenderBrowser> {
  // Loaded lazily so commands that never render release notes never load Puppeteer.
  const { default: puppeteer } = await import('puppeteer-core');
  return (await puppeteer.launch(options)) as unknown as RenderBrowser;
}

// Page-side code is passed as strings: build tools (tsx, esbuild keepNames) can rewrite functions with
// helpers such as `__name` that do not exist in the browser.
const WAIT_FOR_ARTICLE = `document.body && /metadata type/i.test(document.body.innerText)`;
const READ_PAGE = `({ title: document.title, text: document.body ? document.body.innerText : '' })`;
const SKIPPED_RESOURCES = new Set(['image', 'font', 'media']);

export type BrowserRenderOptions = {
  executablePath: string;
  charBudget: number;
  minChars: number;
  timeoutMs?: number;
  launch?: LaunchBrowser;
};

/**
 * Render each release's Metadata API page in one headless browser, concurrently, and return the
 * article for each (or [] when a page fails to load or fails the release checks).
 */
export async function renderReleaseNotes(
  releases: ReleaseNotesTarget[],
  options: BrowserRenderOptions,
): Promise<ReferenceDoc[][]> {
  if (releases.length === 0) return [];
  const timeout = options.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
  const browser = await (options.launch ?? launchWithPuppeteer)({
    executablePath: options.executablePath,
    headless: /chrome-headless-shell/i.test(options.executablePath) ? 'shell' : true,
    args: browserLaunchArgs(),
  });
  try {
    return await Promise.all(
      releases.map(async (release): Promise<ReferenceDoc[]> => {
        let page: RenderPage | undefined;
        try {
          page = await browser.newPage();
          await page.setRequestInterception(true);
          page.on('request', (request) => {
            void (SKIPPED_RESOURCES.has(request.resourceType()) ? request.abort() : request.continue());
          });
          await page.goto(release.url, { waitUntil: 'domcontentloaded', timeout });
          await page.waitForFunction(WAIT_FOR_ARTICLE, { timeout });
          const { title, text } = (await page.evaluate(READ_PAGE)) as { title: string; text: string };
          const article = extractReleaseNotesArticle(text, title, release, options.minChars);
          if (!article) return [];
          return [
            {
              url: release.url,
              title: `Salesforce ${release.name} Release Notes: Metadata API`,
              excerpts: article.slice(0, options.charBudget),
              truncated: article.length > options.charBudget,
            },
          ];
        } catch {
          return [];
        } finally {
          await page?.close().catch(() => undefined);
        }
      }),
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}
