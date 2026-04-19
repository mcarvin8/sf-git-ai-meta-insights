# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights)
[![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)
[![codecov](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights/graph/badge.svg?token=N5FKE0JPHN)](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights)

`sf-git-ai-meta-insights` is an `sf` plugin that generates AI summaries of Salesforce metadata changes from a git diff.

## Overview

This plugin summarizes metadata changes between two Git refs, optionally filters commits by message, and writes a Markdown file using an **OpenAI-compatible** LLM. A configured gateway (API key and/or base URL and/or default headers) is **required**.

![Markdown Summary Example](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/summary-example.png)

## Installation

```bash
sf plugins install sf-git-ai-meta-insights@latest
```

## Command

### `sf sgai metadata summarize`

Summarize metadata changes between two Git refs and write the generated summary to a Markdown file.

#### Flags

| Flag                          | Short | Required | Default               | Description                                                                                     |
| ----------------------------- | ----- | -------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `--from`                      | `-f`  | Yes      |                       | Start reference for the git diff range (e.g. `HEAD~1`, a tag, or a commit hash).                |
| `--to`                        | `-t`  | No       | `HEAD`                | End reference for the git diff range.                                                           |
| `--commit-message-include`    | `-m`  | No       |                       | Include commits whose messages match any of these regex patterns (repeatable, OR).              |
| `--commit-message-exclude`    | `-e`  | No       |                       | Exclude commits whose messages match any of these regex patterns (repeatable, OR).              |
| `--include-package-directory` | `-i`  | No       |                       | Extra repo-relative package paths merged with `sfdx-project.json` directories (repeatable).     |
| `--exclude-package-directory` | `-x`  | No       |                       | Exclude package paths from the configured list and add git `:(exclude)` pathspecs (repeatable). |
| `--team`                      |       | No       |                       | Team or squad label for the summary (also via `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM`).       |
| `--output`                    | `-p`  | No       | `metadata-summary.md` | Output file path for the generated summary.                                                     |
| `--model`                     |       | No       | `gpt-4o-mini`         | OpenAI model used for the summary.                                                              |
| `--max-diff-chars`            |       | No       |                       | Max characters of unified diff text sent to the model (5,000–5,000,000).                        |

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

The plugin requires an **OpenAI-compatible** endpoint. At minimum, set an API key or base URL:

| Variable              | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `OPENAI_API_KEY`      | API key for api.openai.com or your gateway. |
| `LLM_BASE_URL`        | Base URL for an OpenAI-compatible gateway.  |
| `LLM_DEFAULT_HEADERS` | JSON object of extra HTTP headers.          |

> `LLM_*` variants override their `OPENAI_*` counterparts when both are set.
> For the full list of supported environment variables, see the [`@mcarvin/smart-diff` documentation](https://github.com/mcarvin8/smart-diff#llm-configuration).

**PowerShell example with a company gateway**

```powershell
$env:LLM_BASE_URL = "https://llm-gateway.mycompany.example/v1"
$env:LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer <token>","x-tenant-id":"salesforce"}'
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

![Command Example with Company Gateway](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/cmd-example.png)

## Built With

The plugin's core logic is imported from [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff) library, which is a general solution to turn git diffs from any git repository into OpenAI summaries.

## License

MIT
