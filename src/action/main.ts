'use strict';

import * as core from '@actions/core';

import { runMetadataSummarize, type SummarizeOptions } from '../metadata/summarizeCore.js';

const NO_PACKAGE_DIRECTORIES_ERROR =
  'No Salesforce package directories were found in `sfdx-project.json` for this repository ' +
  '(or every package directory was excluded). Configure package directories or use the ' +
  '`include-package-directory` input.';

function noCommitsAfterFilterError(from: string, to: string, include: string, exclude: string): string {
  return `No commits remained after applying commit message filters between ${from} and ${to}. Include: ${include}; exclude: ${exclude}.`;
}

function multilineInput(name: string): string[] {
  return core
    .getMultilineInput(name)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function optionalInput(name: string): string | undefined {
  const value = core.getInput(name);
  return value === '' ? undefined : value;
}

function optionalIntegerInput(name: string): number | undefined {
  const value = core.getInput(name);
  return value === '' ? undefined : Number.parseInt(value, 10);
}

export async function run(): Promise<void> {
  try {
    const options: SummarizeOptions = {
      from: core.getInput('from', { required: true }),
      to: optionalInput('to'),
      'merge-base': core.getBooleanInput('merge-base'),
      'commit-message-include': multilineInput('commit-message-include'),
      'commit-message-exclude': multilineInput('commit-message-exclude'),
      'include-package-directory': multilineInput('include-package-directory'),
      'exclude-package-directory': multilineInput('exclude-package-directory'),
      team: optionalInput('team'),
      output: core.getInput('output') || 'metadata-summary.md',
      model: optionalInput('model'),
      'max-diff-chars': optionalIntegerInput('max-diff-chars'),
      'context-lines': optionalIntegerInput('context-lines'),
      'ignore-whitespace': core.getBooleanInput('ignore-whitespace'),
      'strip-diff-preamble': core.getBooleanInput('strip-diff-preamble'),
      'max-hunk-lines': optionalIntegerInput('max-hunk-lines'),
      'exclude-default-noise': core.getBooleanInput('exclude-default-noise'),
      'map-reduce': core.getBooleanInput('map-reduce'),
      'redact-secrets': core.getBooleanInput('redact-secrets'),
      'max-retries': optionalIntegerInput('max-retries'),
    };

    const { path, usage } = await runMetadataSummarize(
      options,
      NO_PACKAGE_DIRECTORIES_ERROR,
      noCommitsAfterFilterError,
      (message) => core.info(message),
    );

    core.setOutput('summary-path', path);
    core.setOutput('request-count', usage.requestCount);
    core.setOutput('input-tokens', usage.inputTokens);
    core.setOutput('output-tokens', usage.outputTokens);
    core.setOutput('cached-input-tokens', usage.cachedInputTokens);
    core.setOutput('total-tokens', usage.totalTokens);

    core.info(
      `LLM usage: ${usage.requestCount} request(s), ${usage.inputTokens} input tokens, ` +
        `${usage.outputTokens} output tokens, ${usage.cachedInputTokens} cached input tokens, ` +
        `${usage.totalTokens} total tokens.`,
    );
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
