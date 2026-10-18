import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const puppeteerMocks = vi.hoisted(() => ({
  launch: vi.fn(),
  getInstalledBrowsers: vi.fn(),
}));
vi.mock('puppeteer-core', () => ({ default: { launch: puppeteerMocks.launch } }));
vi.mock('@puppeteer/browsers', () => ({ getInstalledBrowsers: puppeteerMocks.getInstalledBrowsers }));

import { MIN_RELEASE_NOTE_CHARS, salesforceReleaseForApiVersion } from '../../src/salesforce/releaseNotes.js';
import {
  BROWSER_INSTALL_HINT,
  browserLaunchArgs,
  extractReleaseNotesArticle,
  findBrowserExecutable,
  type InterceptedRequest,
  type LaunchBrowser,
  type RenderPage,
  renderReleaseNotes,
  standardBrowserPaths,
} from '../../src/salesforce/releaseNotesBrowser.js';

describe('standardBrowserPaths', () => {
  it('lists Chrome and Edge under each Windows program root that is set', () => {
    expect(
      standardBrowserPaths('win32', { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': '', LOCALAPPDATA: 'C:\\Local' }),
    ).toEqual([
      join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('C:\\PF', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join('C:\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('C:\\Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
    expect(standardBrowserPaths('win32', {})).toEqual([]);
  });

  it('lists macOS application bundles and Linux binaries', () => {
    expect(standardBrowserPaths('darwin', {})).toContain(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
    expect(standardBrowserPaths('linux', {})).toEqual([
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ]);
  });
});

describe('findBrowserExecutable', () => {
  const existing =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);

  it('prefers PUPPETEER_EXECUTABLE_PATH, then CHROME_PATH, ignoring blank or missing paths', async () => {
    const installedInCache = vi.fn(async () => []);
    const base = { platform: 'linux' as const, installedInCache };
    await expect(
      findBrowserExecutable({
        ...base,
        env: { PUPPETEER_EXECUTABLE_PATH: ' /p/chrome ', CHROME_PATH: '/c/chrome' },
        exists: existing('/p/chrome', '/c/chrome'),
      }),
    ).resolves.toBe('/p/chrome');
    await expect(
      findBrowserExecutable({
        ...base,
        env: { PUPPETEER_EXECUTABLE_PATH: '/missing', CHROME_PATH: '/c/chrome' },
        exists: existing('/c/chrome'),
      }),
    ).resolves.toBe('/c/chrome');
    await expect(
      findBrowserExecutable({
        ...base,
        env: { PUPPETEER_EXECUTABLE_PATH: '  ' },
        exists: existing('/usr/bin/chromium'),
      }),
    ).resolves.toBe('/usr/bin/chromium');
    expect(installedInCache).not.toHaveBeenCalled();
  });

  it('uses the first standard install that exists', async () => {
    await expect(
      findBrowserExecutable({
        env: {},
        platform: 'linux',
        exists: existing('/usr/bin/chromium', '/snap/bin/chromium'),
        installedInCache: async () => [],
      }),
    ).resolves.toBe('/usr/bin/chromium');
  });

  it('falls back to the Puppeteer cache, honoring PUPPETEER_CACHE_DIR', async () => {
    const installedInCache = vi.fn(async () => ['/cache/stale', '/cache/chrome-headless-shell']);
    await expect(
      findBrowserExecutable({
        env: { PUPPETEER_CACHE_DIR: ' /ci/cache ' },
        platform: 'linux',
        exists: existing('/cache/chrome-headless-shell'),
        installedInCache,
      }),
    ).resolves.toBe('/cache/chrome-headless-shell');
    expect(installedInCache).toHaveBeenCalledWith('/ci/cache');

    installedInCache.mockClear();
    await findBrowserExecutable({ env: {}, platform: 'linux', exists: () => false, installedInCache });
    expect(installedInCache).toHaveBeenCalledWith(join(homedir(), '.cache', 'puppeteer'));
  });

  it('returns undefined when nothing is installed or the cache cannot be read', async () => {
    await expect(
      findBrowserExecutable({ env: {}, platform: 'linux', exists: () => false, installedInCache: async () => [] }),
    ).resolves.toBeUndefined();
    await expect(
      findBrowserExecutable({
        env: {},
        platform: 'linux',
        exists: () => false,
        installedInCache: async () => Promise.reject(new Error('corrupt cache')),
      }),
    ).resolves.toBeUndefined();
  });

  it('defaults to process.env and the real file system', async () => {
    // This test file exists, so it stands in for a browser executable named by the environment.
    const executable = fileURLToPath(import.meta.url);
    vi.stubEnv('PUPPETEER_EXECUTABLE_PATH', executable);
    try {
      await expect(findBrowserExecutable({ installedInCache: async () => [] })).resolves.toBe(executable);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('defaults to the current platform for standard install paths', async () => {
    const checked: string[] = [];
    await findBrowserExecutable({
      env: {},
      exists: (path) => {
        checked.push(path);
        return false;
      },
      installedInCache: async () => [],
    });
    expect(checked).toEqual(standardBrowserPaths(process.platform, {}));
  });

  it('reads an empty Puppeteer cache directory without error', async () => {
    await expect(
      findBrowserExecutable({
        env: { PUPPETEER_CACHE_DIR: join(homedir(), 'sgai-no-such-dir') },
        platform: 'linux',
        exists: () => false,
      }),
    ).resolves.toBeUndefined();
  });

  it('suggests installing the headless shell into the default cache', () => {
    expect(BROWSER_INSTALL_HINT).toBe(
      'npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/puppeteer',
    );
  });
});

describe('browserLaunchArgs', () => {
  it('adds CI-safe flags for Linux and root', () => {
    expect(browserLaunchArgs('linux', 0)).toEqual(['--disable-dev-shm-usage', '--no-sandbox']);
    expect(browserLaunchArgs('linux', 1000)).toEqual(['--disable-dev-shm-usage']);
    expect(browserLaunchArgs('darwin', undefined)).toEqual([]);
    expect(browserLaunchArgs('win32', 0)).toEqual(['--no-sandbox']);
  });
});

const RELEASE = salesforceReleaseForApiVersion(67);
const BODY = 'Use the new FlowActionCallPath metadata type. Available in API version 67.0 and later.\n'.repeat(15);

function pageText({ heading = 'Salesforce Summer ’26 Release Notes', body = BODY } = {}): string {
  return [
    'Agentforce is temporarily unavailable.',
    heading,
    'Show Table of Contents',
    'Metadata API',
    'Access more metadata through these new and changed metadata types.',
    'Loading',
    '',
    body,
    'Loading',
    'DID THIS ARTICLE SOLVE YOUR ISSUE?',
    'Yes',
  ].join('\n');
}

describe('extractReleaseNotesArticle', () => {
  it('cuts the article between its start and the feedback footer, dropping blank and Loading lines', () => {
    const article = extractReleaseNotesArticle(pageText(), 'Metadata API | Salesforce Help', RELEASE, 100);
    expect(article?.startsWith('new and changed metadata types.\nUse the new FlowActionCallPath')).toBe(true);
    expect(article?.endsWith('Available in API version 67.0 and later.')).toBe(true);
    expect(article).not.toMatch(/Loading|DID THIS ARTICLE|Show Table/);
  });

  it('accepts a straight apostrophe in the heading and keeps text without the usual markers', () => {
    const text = `Salesforce Summer '26 Release Notes\n${BODY}`;
    expect(extractReleaseNotesArticle(text, 'Metadata API', RELEASE, 100)).toBe(
      `Salesforce Summer '26 Release Notes\n${BODY.trim()}`,
    );
  });

  it('rejects other pages and other releases', () => {
    expect(extractReleaseNotesArticle(pageText(), 'Salesforce Help', RELEASE, 100)).toBeUndefined();
    expect(
      extractReleaseNotesArticle(
        pageText({ heading: 'Salesforce Spring ’26 Release Notes' }),
        'Metadata API',
        RELEASE,
        100,
      ),
    ).toBeUndefined();
    expect(
      extractReleaseNotesArticle(
        pageText({ heading: 'Salesforce Summer ’25 Release Notes' }),
        'Metadata API',
        RELEASE,
        100,
      ),
    ).toBeUndefined();
    expect(
      extractReleaseNotesArticle(pageText({ heading: 'Summer ’26' }), 'Metadata API', RELEASE, 100),
    ).toBeUndefined();
  });

  it('uses only the first release heading on the page', () => {
    const text = pageText().replace('Show Table of Contents', 'See also Salesforce Spring ’26 Release Notes');
    expect(extractReleaseNotesArticle(text, 'Metadata API', RELEASE, 100)).toBeDefined();
    const spring = salesforceReleaseForApiVersion(66);
    expect(extractReleaseNotesArticle(text, 'Metadata API', spring, 100)).toBeUndefined();
  });

  it('rejects short articles and articles that never mention metadata types', () => {
    expect(extractReleaseNotesArticle(pageText(), 'Metadata API', RELEASE, 100_000)).toBeUndefined();
    const noTypes = pageText({ body: 'Nothing relevant here at all. '.repeat(60) }).replace(
      'new and changed metadata types',
      'new and changed things',
    );
    expect(extractReleaseNotesArticle(noTypes, 'Metadata API', RELEASE, 100)).toBeUndefined();
  });

  it('keeps release notes that announce future removals', () => {
    const body = `${BODY}isTypingIndicatorDisabled will be removed in API version 68.0.\n`;
    expect(extractReleaseNotesArticle(pageText({ body }), 'Metadata API', RELEASE, 100)).toContain('68.0');
  });
});

type FakePageScript = { title?: string; text?: string; fail?: 'goto' | 'wait' | 'evaluate' };

function fakeBrowser(scripts: Record<string, FakePageScript>) {
  const pages: Array<{
    url?: string;
    closed: boolean;
    handler?: (r: InterceptedRequest) => void;
    interception?: boolean;
  }> = [];
  let closed = false;
  const launch = vi.fn<LaunchBrowser>(async () => ({
    newPage: async () => {
      const state: (typeof pages)[number] = { closed: false };
      pages.push(state);
      const script = () => scripts[state.url ?? ''] ?? {};
      const page: RenderPage = {
        setRequestInterception: async (enabled) => {
          state.interception = enabled;
        },
        on: (_event, handler) => {
          state.handler = handler;
        },
        goto: async (url, options) => {
          state.url = url;
          expect(options).toEqual({ waitUntil: 'domcontentloaded', timeout: 1234 });
          if (script().fail === 'goto') throw new Error('net::ERR_FAILED');
        },
        waitForFunction: async (expression) => {
          expect(typeof expression).toBe('string');
          if (script().fail === 'wait') throw new Error('timeout');
        },
        evaluate: async (expression) => {
          expect(typeof expression).toBe('string');
          if (script().fail === 'evaluate') throw new Error('detached');
          return { title: script().title ?? 'Metadata API | Salesforce Help', text: script().text ?? '' };
        },
        close: async () => {
          state.closed = true;
          throw new Error('already closed');
        },
      };
      return page;
    },
    close: async () => {
      closed = true;
      throw new Error('browser gone');
    },
  }));
  return { launch, pages, isClosed: () => closed };
}

describe('renderReleaseNotes', () => {
  const summer = salesforceReleaseForApiVersion(67);
  const spring = salesforceReleaseForApiVersion(66);
  const winter = salesforceReleaseForApiVersion(65);
  const options = { charBudget: 200, minChars: 100, timeoutMs: 1234 };

  it('does not launch a browser for no releases', async () => {
    const { launch } = fakeBrowser({});
    await expect(renderReleaseNotes([], { ...options, executablePath: '/chrome', launch })).resolves.toEqual([]);
    expect(launch).not.toHaveBeenCalled();
  });

  it('renders each release in its own page and returns per-release results', async () => {
    const { launch, pages, isClosed } = fakeBrowser({
      [summer.url]: { text: pageText() },
      [spring.url]: { text: pageText() },
      [winter.url]: { fail: 'wait' },
    });

    const docs = await renderReleaseNotes([summer, spring, winter], {
      ...options,
      executablePath: '/usr/bin/chromium',
      launch,
    });

    expect(launch).toHaveBeenCalledWith({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: browserLaunchArgs(),
    });
    expect(docs[0]).toEqual([
      {
        url: summer.url,
        title: "Salesforce Summer '26 Release Notes: Metadata API",
        excerpts: expect.stringMatching(/^new and changed metadata types\./),
        truncated: true,
      },
    ]);
    expect(docs[0][0].excerpts).toHaveLength(200);
    expect(docs[1]).toEqual([]);
    expect(docs[2]).toEqual([]);
    expect(pages.map((p) => p.url).sort()).toEqual([summer.url, spring.url, winter.url].sort());
    expect(pages.every((p) => p.closed && p.interception)).toBe(true);
    expect(isClosed()).toBe(true);
  });

  it('marks short articles as untruncated', async () => {
    const { launch } = fakeBrowser({ [summer.url]: { text: pageText() } });
    const [docs] = await renderReleaseNotes([summer], {
      ...options,
      charBudget: 100_000,
      executablePath: '/c',
      launch,
    });
    expect(docs[0].truncated).toBe(false);
  });

  it('uses headless shell mode for chrome-headless-shell executables', async () => {
    const { launch } = fakeBrowser({});
    await renderReleaseNotes([summer], {
      ...options,
      executablePath: '/cache/chrome-headless-shell/linux-1/chrome-headless-shell',
      launch,
    });
    expect(launch.mock.calls[0][0].headless).toBe('shell');
  });

  it('skips images, fonts, and media but lets other requests through', async () => {
    const { launch, pages } = fakeBrowser({ [summer.url]: { text: pageText() } });
    await renderReleaseNotes([summer], { ...options, executablePath: '/c', launch });
    const handler = pages[0].handler as (r: InterceptedRequest) => void;
    for (const [type, expected] of [
      ['image', 'abort'],
      ['font', 'abort'],
      ['media', 'abort'],
      ['script', 'continue'],
      ['document', 'continue'],
    ] as const) {
      const request = { resourceType: () => type, abort: vi.fn(async () => {}), continue: vi.fn(async () => {}) };
      handler(request);
      expect(request[expected]).toHaveBeenCalled();
      expect(request[expected === 'abort' ? 'continue' : 'abort']).not.toHaveBeenCalled();
    }
  });

  it('returns [] for pages that fail to load or read, and still closes the browser', async () => {
    const { launch, isClosed } = fakeBrowser({
      [summer.url]: { fail: 'goto' },
      [spring.url]: { fail: 'evaluate' },
    });
    await expect(renderReleaseNotes([summer, spring], { ...options, executablePath: '/c', launch })).resolves.toEqual([
      [],
      [],
    ]);
    expect(isClosed()).toBe(true);
  });

  it('returns [] when a page cannot be opened', async () => {
    const launch: LaunchBrowser = async () => ({
      newPage: async () => Promise.reject(new Error('target closed')),
      close: async () => {},
    });
    await expect(renderReleaseNotes([summer], { ...options, executablePath: '/c', launch })).resolves.toEqual([[]]);
  });

  it('propagates launch failures so the caller can fall back', async () => {
    const launch: LaunchBrowser = async () => Promise.reject(new Error('libnss3.so: cannot open shared object file'));
    await expect(renderReleaseNotes([summer], { ...options, executablePath: '/c', launch })).rejects.toThrow('libnss3');
  });

  it('uses the release-note minimum from the caller', async () => {
    const { launch } = fakeBrowser({ [summer.url]: { text: pageText() } });
    const [docs] = await renderReleaseNotes([summer], {
      ...options,
      minChars: MIN_RELEASE_NOTE_CHARS * 10,
      executablePath: '/c',
      launch,
    });
    expect(docs).toEqual([]);
  });
});

describe('Puppeteer integration (lazy imports)', () => {
  it('reads cached browsers, preferring the headless shell, then Chrome, then Chromium', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'sgai-puppeteer-cache-'));
    try {
      puppeteerMocks.getInstalledBrowsers.mockResolvedValue([
        { browser: 'firefox', executablePath: '/cache/firefox' },
        { browser: 'chromium', executablePath: '/cache/chromium' },
        { browser: 'chrome', executablePath: '/cache/chrome' },
        { browser: 'chrome-headless-shell', executablePath: '/cache/shell' },
      ]);
      const seen: string[] = [];
      const found = await findBrowserExecutable({
        env: { PUPPETEER_CACHE_DIR: cacheDir },
        platform: 'linux',
        exists: (path) => {
          seen.push(path);
          return path === '/cache/chrome' || path === '/cache/chromium';
        },
      });
      expect(puppeteerMocks.getInstalledBrowsers).toHaveBeenCalledWith({ cacheDir });
      expect(found).toBe('/cache/chrome');
      expect(seen.filter((p) => p.startsWith('/cache/'))).toEqual(['/cache/shell', '/cache/chrome']);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('launches puppeteer-core with the resolved options when no launcher is injected', async () => {
    const close = vi.fn(async () => {});
    puppeteerMocks.launch.mockResolvedValue({ newPage: async () => Promise.reject(new Error('no pages')), close });
    const release = salesforceReleaseForApiVersion(67);

    await expect(
      renderReleaseNotes([release], { executablePath: '/usr/bin/chromium', charBudget: 10, minChars: 1 }),
    ).resolves.toEqual([[]]);

    expect(puppeteerMocks.launch).toHaveBeenCalledWith({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: browserLaunchArgs(),
    });
    expect(close).toHaveBeenCalled();
  });
});
