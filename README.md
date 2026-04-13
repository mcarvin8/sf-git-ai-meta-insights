# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights) [![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights) [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)

`sf-git-ai-meta-insights` is an `sf` plugin that generates AI-assisted summaries of Salesforce metadata changes from a git diff.

## Overview

This plugin summarizes metadata changes between two Git refs, optionally filters commits by message, and writes a Markdown summary file. When an **OpenAI-compatible** LLM gateway is configured (see below), it calls that HTTP API; otherwise it falls back to a local summary.

## Installation

```bash
sf plugins install sf-git-ai-meta-insights@latest
```

## Command

### `sf sgai metadata summarize`

Summarize metadata changes between two Git refs and write the generated summary to a Markdown file.

#### Flags

- `--from` `-f` (**required**) Start reference for the git diff range. You must pass an explicit ref (for example `HEAD~1`, a tag, or a commit hash); there is no default.
- `--to` `-t` End reference for the git diff range. Defaults to `HEAD`.
- `--message-filter` `-m` Regex filter for commit messages.
- `--team` Optional team or squad label for the summary (also supported via `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM`).
- `--output` `-p` Output file path for the generated summary. Defaults to `metadata-summary.md`.
- `--model` OpenAI model used for the summary. Defaults to `gpt-4o-mini`.
- `--ignore-package-directory` `-i` Ignore package directories defined in `sfdx-project.json`. This flag may be provided multiple times.

#### Examples

Summarize changes since the previous commit:

```bash
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

Summarize a custom range and save to `changes.md`:

```bash
sf sgai metadata summarize --from HEAD~5 --to HEAD --output changes.md
```

Summarize only commits whose messages match a regex:

```bash
sf sgai metadata summarize --from main --to HEAD --message-filter "(feature|fix)"
```

Use a custom OpenAI model:

```bash
sf sgai metadata summarize --from HEAD~1 --to HEAD --model gpt-4o-mini
```

## Requirements

- `sf` CLI installed
- Node.js 20 or later
- A Salesforce DX project repository with a `sfdx-project.json` file present in the repo root
- Optional: LLM configuration (see below)

This plugin depends on running inside an SFDX project because it reads `packageDirectories` from `sfdx-project.json` to determine which metadata files from the git diff to include in the summary.

If no LLM gateway is configured, the plugin still generates a local fallback summary.

The plugin uses the official Node [`openai`](https://www.npmjs.com/package/openai) client: optional **`baseURL`**, optional **`defaultHeaders`** (JSON), and an API key string the SDK expects.

### `LLM_*` overrides `OPENAI_*`

| Variable                 | Purpose                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | Default API key for api.openai.com or your gateway.                                         |
| `LLM_API_KEY`            | Overrides `OPENAI_API_KEY` when set.                                                        |
| `OPENAI_BASE_URL`        | Default base URL (OpenAI-compatible).                                                       |
| `LLM_BASE_URL`           | Overrides `OPENAI_BASE_URL` when set.                                                       |
| `OPENAI_DEFAULT_HEADERS` | JSON object of extra HTTP headers (string values only).                                     |
| `LLM_DEFAULT_HEADERS`    | JSON object merged **on top of** `OPENAI_DEFAULT_HEADERS` (same header names are replaced). |

The OpenAI Node client always sends `Authorization: Bearer <apiKey>`. If you put a raw `sk-...` value in `LLM_DEFAULT_HEADERS` / `OPENAI_DEFAULT_HEADERS` as `Authorization` **without** `Bearer`, many gateways treat that as the final header and return errors like `401` with `param: api_key`. When `LLM_API_KEY` / `OPENAI_API_KEY` is unset, this plugin detects `Authorization: sk-...` or `Authorization: Bearer sk-...` in the merged JSON headers, moves that token into the client `apiKey` (so the SDK sends a proper `Bearer` value), and removes the duplicate `Authorization` entry from `defaultHeaders` while keeping your other headers (for example `x-alfa-rbac`).

Prefer setting `LLM_API_KEY` (or `OPENAI_API_KEY`) to your `sk-...` token when your gateway documents API-key auth that way.

**PowerShell: company gateway**

```powershell
$env:LLM_BASE_URL = "https://llm-gateway.mycompany.example/v1"
$env:LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer <token>","x-tenant-id":"salesforce"}'
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

![Command Example with Company Gateway](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/cmd-example.png)

### OpenAI (api.openai.com)

Set `OPENAI_API_KEY` only, or `LLM_API_KEY` if you standardize on `LLM_*` in your environment.

### Token limits

`OPENAI_MAX_TOKENS` caps `max_tokens`; `LLM_MAX_TOKENS` overrides it when set.

### Diff size (context window)

The full unified diff is capped before it is sent to the LLM so requests stay within typical context limits (for example 128k tokens). If you see errors about context length exceeded, narrow `--from`/`--to`, use `--message-filter`, or lower `--max-diff-chars` / `LLM_MAX_DIFF_CHARS`. Only raise the cap when your model and gateway allow a larger context.

## License

MIT
