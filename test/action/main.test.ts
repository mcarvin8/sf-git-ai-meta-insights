import * as core from '@actions/core';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { run } from '../../src/action/main.js';
import { runMetadataSummarize } from '../../src/metadata/summarizeCore.js';

vi.mock('@actions/core');
vi.mock('../../src/metadata/summarizeCore.js');

const runMock = runMetadataSummarize as unknown as Mock;
const getInputMock = core.getInput as unknown as Mock;
const getMultilineInputMock = core.getMultilineInput as unknown as Mock;
const getBooleanInputMock = core.getBooleanInput as unknown as Mock;

function stubInputs(
  inputs: Record<string, string>,
  multilineInputs: Record<string, string[]> = {},
  booleanInputs: Record<string, boolean> = {},
): void {
  getInputMock.mockImplementation((name: string) => inputs[name] ?? '');
  getMultilineInputMock.mockImplementation((name: string) => multilineInputs[name] ?? []);
  getBooleanInputMock.mockImplementation((name: string) => booleanInputs[name] ?? false);
}

const baseUsage = {
  requestCount: 1,
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 0,
  totalTokens: 150,
};

describe('GitHub Action entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps inputs to runMetadataSummarize, trimming/filtering multiline values and defaulting optional inputs to undefined', async () => {
    stubInputs(
      { from: 'HEAD~1', to: '', team: '', model: '', 'max-diff-chars': '', 'max-retries': '' },
      {
        'commit-message-include': ['  feat.*  ', '', 'fix.*'],
        'commit-message-exclude': ['  chore.*  '],
        'include-package-directory': ['  force-app  '],
        'exclude-package-directory': [],
      },
      {
        'merge-base': false,
        'ignore-whitespace': false,
        'strip-diff-preamble': false,
        'exclude-default-noise': false,
        'map-reduce': false,
        'redact-secrets': false,
      },
    );
    runMock.mockResolvedValue({ path: 'metadata-summary.md', usage: baseUsage });

    await run();

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'HEAD~1',
        to: undefined,
        'merge-base': false,
        'commit-message-include': ['feat.*', 'fix.*'],
        'commit-message-exclude': ['chore.*'],
        'include-package-directory': ['force-app'],
        'exclude-package-directory': [],
        team: undefined,
        output: 'metadata-summary.md',
        model: undefined,
        'max-diff-chars': undefined,
        'max-retries': undefined,
      }),
      expect.any(String),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('parses numeric inputs and defaults output to metadata-summary.md when empty', async () => {
    stubInputs({
      from: 'HEAD~1',
      output: '',
      'max-diff-chars': '20000',
      'context-lines': '5',
      'max-hunk-lines': '200',
      'max-retries': '3',
    });
    runMock.mockResolvedValue({ path: 'metadata-summary.md', usage: baseUsage });

    await run();

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output: 'metadata-summary.md',
        'max-diff-chars': 20_000,
        'context-lines': 5,
        'max-hunk-lines': 200,
        'max-retries': 3,
      }),
      expect.any(String),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('passes through non-empty optional string inputs', async () => {
    stubInputs({ from: 'HEAD~1', to: 'HEAD', team: 'release-eng', model: 'claude-3-5-sonnet-latest' });
    runMock.mockResolvedValue({ path: 'metadata-summary.md', usage: baseUsage });

    await run();

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'HEAD', team: 'release-eng', model: 'claude-3-5-sonnet-latest' }),
      expect.any(String),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('sets outputs and logs usage on success', async () => {
    stubInputs({ from: 'HEAD~1' });
    runMock.mockResolvedValue({ path: 'metadata-summary.md', usage: baseUsage });

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('summary-path', 'metadata-summary.md');
    expect(core.setOutput).toHaveBeenCalledWith('request-count', 1);
    expect(core.setOutput).toHaveBeenCalledWith('input-tokens', 100);
    expect(core.setOutput).toHaveBeenCalledWith('output-tokens', 50);
    expect(core.setOutput).toHaveBeenCalledWith('cached-input-tokens', 0);
    expect(core.setOutput).toHaveBeenCalledWith('total-tokens', 150);
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'LLM usage: 1 request(s), 100 input tokens, 50 output tokens, 0 cached input tokens, 150 total tokens.',
    );
  });

  it('requests "from" as a required input, and queries every other input by its exact name', async () => {
    stubInputs({ from: 'HEAD~1' });
    runMock.mockResolvedValue({ path: 'metadata-summary.md', usage: baseUsage });

    await run();

    expect(getInputMock).toHaveBeenCalledWith('from', { required: true });
    expect(getInputMock).toHaveBeenCalledWith('to');
    expect(getInputMock).toHaveBeenCalledWith('team');
    expect(getInputMock).toHaveBeenCalledWith('output');
    expect(getInputMock).toHaveBeenCalledWith('model');
    expect(getInputMock).toHaveBeenCalledWith('max-diff-chars');
    expect(getInputMock).toHaveBeenCalledWith('context-lines');
    expect(getInputMock).toHaveBeenCalledWith('max-hunk-lines');
    expect(getInputMock).toHaveBeenCalledWith('max-retries');
    expect(getMultilineInputMock).toHaveBeenCalledWith('commit-message-include');
    expect(getMultilineInputMock).toHaveBeenCalledWith('commit-message-exclude');
    expect(getMultilineInputMock).toHaveBeenCalledWith('include-package-directory');
    expect(getMultilineInputMock).toHaveBeenCalledWith('exclude-package-directory');
    expect(getBooleanInputMock).toHaveBeenCalledWith('merge-base');
    expect(getBooleanInputMock).toHaveBeenCalledWith('ignore-whitespace');
    expect(getBooleanInputMock).toHaveBeenCalledWith('strip-diff-preamble');
    expect(getBooleanInputMock).toHaveBeenCalledWith('exclude-default-noise');
    expect(getBooleanInputMock).toHaveBeenCalledWith('map-reduce');
    expect(getBooleanInputMock).toHaveBeenCalledWith('redact-secrets');
  });

  it('passes the literal no-package-directories error message through to runMetadataSummarize', async () => {
    stubInputs({ from: 'HEAD~1' });
    runMock.mockResolvedValue({ path: 'metadata-summary.md', usage: baseUsage });

    await run();

    expect(runMock).toHaveBeenCalledWith(
      expect.anything(),
      'No Salesforce package directories were found in `sfdx-project.json` for this repository ' +
        '(or every package directory was excluded). Configure package directories or use the ' +
        '`include-package-directory` input.',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('builds the no-commits-after-filter error message from the resolved args', async () => {
    stubInputs({ from: 'HEAD~1' });
    let capturedMessage: string | undefined;
    runMock.mockImplementation(
      async (
        _options: unknown,
        _noPackageDirectoriesError: string,
        noCommitsAfterFilterError: (from: string, to: string, include: string, exclude: string) => string,
      ) => {
        capturedMessage = noCommitsAfterFilterError('HEAD~1', 'HEAD', '[]', '[]');
        return { path: 'metadata-summary.md', usage: baseUsage };
      },
    );

    await run();

    expect(capturedMessage).toBe(
      'No commits remained after applying commit message filters between HEAD~1 and HEAD. Include: []; exclude: [].',
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('forwards the log callback to core.info', async () => {
    stubInputs({ from: 'HEAD~1' });
    runMock.mockImplementation(
      async (_options: unknown, _noPkg: string, _noCommits: unknown, log: (message: string) => void) => {
        log('Generated metadata summary at metadata-summary.md');
        return { path: 'metadata-summary.md', usage: baseUsage };
      },
    );

    await run();

    expect(core.info).toHaveBeenCalledWith('Generated metadata summary at metadata-summary.md');
  });

  it('fails the action with the error message when runMetadataSummarize throws', async () => {
    stubInputs({ from: 'HEAD~1' });
    runMock.mockRejectedValue(new Error('boom'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('boom');
  });

  it('fails the action with String(error) when the thrown value is not an Error instance', async () => {
    stubInputs({ from: 'HEAD~1' });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    runMock.mockRejectedValue('a plain string rejection');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('a plain string rejection');
  });
});
