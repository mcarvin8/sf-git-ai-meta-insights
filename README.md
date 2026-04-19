# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights)
[![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)
[![codecov](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights/graph/badge.svg?token=N5FKE0JPHN)](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights)

`sf-git-ai-meta-insights` is an `sf` plugin that generates AI summaries of Salesforce metadata changes from a git diff.

## Overview

This plugin summarizes metadata changes between two Git refs, optionally filters commits by message, and writes a Markdown file using an **OpenAI-compatible** LLM. A configured gateway (API key and/or base URL and/or default headers) is **required**.

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
- `--commit-message-include` `-m` Include commits whose messages match any of these regex patterns (repeatable, OR).
- `--commit-message-exclude` `-e` Exclude commits whose messages match any of these regex patterns (repeatable, OR).
- `--include-package-directory` `-i` Extra repo-relative package paths merged with `sfdx-project.json` package directories (repeatable).
- `--exclude-package-directory` `-x` Exclude package paths: removes matching entries from the configured package list and adds git `:(exclude)` pathspecs for the diff (repeatable).
- `--team` Optional team or squad label for the summary (also supported via `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM`).
- `--output` `-p` Output file path for the generated summary. Defaults to `metadata-summary.md`.
- `--model` OpenAI model used for the summary. Defaults to `gpt-4o-mini`.

#### Examples

Summarize changes since the previous commit:

```bash
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

Summarize changes from the past week on main branch:

```bash
FROM=$(git log origin/main -1 --before="1 week ago" --pretty=format:%H)
sf sgai metadata summarize --from "$FROM"  --to "origin/main"
```

Summarize a custom range and save to `changes.md`:

```bash
sf sgai metadata summarize --from HEAD~5 --to HEAD --output changes.md
```

Summarize only commits whose messages match a regex:

```bash
sf sgai metadata summarize --from main --to HEAD --commit-message-include "(feature|fix)"
```

Set a specific OpenAI model:

```bash
sf sgai metadata summarize --from HEAD~1 --to HEAD --model gpt-4o-mini
```

## Requirements

- `sf` CLI installed
- Node.js 20 or later
- **OpenAI configuration**—see below
- A Salesforce DX project repository with a `sfdx-project.json` file present in the repo root (unless you pass only `--include-package-directory` paths)
- [Git Bash](https://git-scm.com/install/)

This plugin reads `packageDirectories` from `sfdx-project.json` (when present) to scope the git diff, merges optional CLI include/exclude paths, then sends context to the model.

### OpenAI Configuration

The plugin uses the official Node [`openai`](https://www.npmjs.com/package/openai) client: 

- **`apiKey`** is required by the client but can be null if you set headers
- optional **`baseURL`**
- optional **`defaultHeaders`** (JSON)

> `LLM_*` overrides `OPENAI_*` if both are found

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

**PowerShell example with a company gateway**

```powershell
$env:LLM_BASE_URL = "https://llm-gateway.mycompany.example/v1"
$env:LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer <token>","x-tenant-id":"salesforce"}'
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

![Command Example with Company Gateway](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/cmd-example.png)
![Markdown Summary Example](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/summary-example.png)

#### Token limits

`OPENAI_MAX_TOKENS` caps `max_tokens`; `LLM_MAX_TOKENS` overrides it when set.

#### Diff size

The full unified diff is capped before it is sent to the LLM so requests stay within typical context limits (for example 128k tokens). If you see errors about context length exceeded, narrow `--from`/`--to`, use `--commit-message-include` / `--commit-message-exclude`, or lower `--max-diff-chars` / `LLM_MAX_DIFF_CHARS`. Only raise the cap when your model and gateway allow a larger context.

## Built With

The plugin's core logic is imported from [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff) library, which is a general solution to turn git diffs from any git repository into OpenAI summaries.

## License

MIT
