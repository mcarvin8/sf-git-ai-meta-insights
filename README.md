# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights)
[![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)
[![codecov](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights/graph/badge.svg?token=N5FKE0JPHN)](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights)

`sf-git-ai-meta-insights` is an `sf` plugin that generates AI summaries of Salesforce metadata changes from a git diff.

## Overview

This plugin summarizes metadata changes between two Git refs, optionally filters commits by message, and writes a Markdown file using any LLM provider supported by the [Vercel AI SDK](https://sdk.vercel.ai) — OpenAI, Anthropic, Google Gemini, Amazon Bedrock, Mistral, Cohere, Groq, xAI, DeepSeek, or any OpenAI-compatible gateway. A configured provider (API key, base URL, and/or default headers) is **required**.

![Markdown Summary Example](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/summary-example.png)

## Installation

```bash
sf plugins install sf-git-ai-meta-insights@latest
```

## Command

### `sf sgai metadata summarize`

Summarize metadata changes between two Git refs and write the generated summary to a Markdown file.

#### Flags

| Flag                          | Short | Required | Default               | Description                                                                                                                                                                         |
| ----------------------------- | ----- | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from`                      | `-f`  | Yes      |                       | Start reference for the git diff range (e.g. `HEAD~1`, a tag, or a commit hash).                                                                                                    |
| `--to`                        | `-t`  | No       | `HEAD`                | End reference for the git diff range.                                                                                                                                               |
| `--commit-message-include`    | `-m`  | No       |                       | Include commits whose messages match any of these regex patterns (repeatable, OR).                                                                                                  |
| `--commit-message-exclude`    | `-e`  | No       |                       | Exclude commits whose messages match any of these regex patterns (repeatable, OR).                                                                                                  |
| `--include-package-directory` | `-i`  | No       |                       | Extra repo-relative package paths merged with `sfdx-project.json` directories (repeatable).                                                                                         |
| `--exclude-package-directory` | `-x`  | No       |                       | Exclude package paths from the configured list and add git `:(exclude)` pathspecs (repeatable).                                                                                     |
| `--team`                      |       | No       |                       | Team or squad label for the summary (also via `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM`).                                                                                           |
| `--output`                    | `-p`  | No       | `metadata-summary.md` | Output file path for the generated summary.                                                                                                                                         |
| `--model`                     |       | No       | _provider default_    | Override the chat model id. Defaults to the resolved provider's default (e.g. `gpt-4o-mini` for OpenAI, `claude-3-5-haiku-latest` for Anthropic). Can also be set with `LLM_MODEL`. |
| `--max-diff-chars`            |       | No       |                       | Max characters of unified diff text sent to the model (5,000–5,000,000).                                                                                                            |
| `--context-lines`             |       | No       | _git default (3)_     | `git diff -U<n>` context lines around each change (0–1,000). Lower values cut tokens on modification-heavy diffs.                                                                   |
| `--ignore-whitespace`         |       | No       | `false`               | Pass `-w` / `--ignore-all-space` to `git diff` so whitespace-only hunks don't consume tokens (also applied to `--numstat` / `--name-status`).                                       |
| `--strip-diff-preamble`       |       | No       | `false`               | Drop low-value `diff --git`/`index`/`mode`/`similarity`/`rename`/`copy` lines from the unified diff; `--- a/…`, `+++ b/…`, and `@@` hunk headers are kept.                          |
| `--max-hunk-lines`            |       | No       |                       | Cap each hunk's body (1–100,000); anything past the limit is elided to a single marker. `@@` header and `DiffSummary` totals stay intact.                                           |
| `--exclude-default-noise`     |       | No       | `false`               | Merge smart-diff's built-in `DEFAULT_NOISE_EXCLUDES` list (lockfiles, `dist`, `build`, `out`, `coverage`, `node_modules`, `__snapshots__`) into excluded pathspecs.                 |

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

Override the chat model (any model id your configured provider supports):

```bash
sf sgai metadata summarize --from HEAD~1 --to HEAD --model claude-3-5-sonnet-latest
```

Reduce LLM token cost with unified-diff shaping (ignore whitespace, trim context, elide huge hunks, strip low-value preamble lines):

```bash
sf sgai metadata summarize \
  --from HEAD~5 --to HEAD \
  --ignore-whitespace \
  --context-lines 1 \
  --strip-diff-preamble \
  --max-hunk-lines 400
```

These flags only reshape the unified diff text sent to the model — the structured change inventory (file counts, additions, deletions) is computed separately and is always accurate. See the [`@mcarvin/smart-diff` "Reducing tokens" guide](https://github.com/mcarvin8/smart-diff#reducing-tokens) for details on each option.

## Requirements

- `sf` CLI installed
- Node.js 20 or later
- A configured LLM provider—see [Provider configuration](#provider-configuration)
- A Salesforce DX project repository with a `sfdx-project.json` file present in the repo root (unless you pass only `--include-package-directory` paths)
- [Git Bash](https://git-scm.com/install/)

This plugin reads `packageDirectories` from `sfdx-project.json` (when present) to scope the git diff, merges optional CLI include/exclude paths, then sends context to the model.

### Provider configuration

The plugin delegates provider resolution to [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff), which uses the Vercel AI SDK. Any of the supported providers below will work — set credentials for whichever one you want to use. If multiple are set, `LLM_PROVIDER` explicitly selects one; otherwise the resolver auto-detects based on which env vars are present.

| Provider (`LLM_PROVIDER`) | Credential env vars                                                        | Default model                              |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| `openai`                  | `OPENAI_API_KEY` or `LLM_API_KEY`                                          | `gpt-4o-mini`                              |
| `openai-compatible`       | `LLM_BASE_URL`/`OPENAI_BASE_URL` (required); API key and/or custom headers | `gpt-4o-mini`                              |
| `anthropic`               | `ANTHROPIC_API_KEY`                                                        | `claude-3-5-haiku-latest`                  |
| `google`                  | `GOOGLE_GENERATIVE_AI_API_KEY` or `GOOGLE_API_KEY`                         | `gemini-2.0-flash`                         |
| `bedrock`                 | Standard AWS credential chain (env / profile / role)                       | `anthropic.claude-3-5-haiku-20241022-v1:0` |
| `mistral`                 | `MISTRAL_API_KEY`                                                          | `mistral-small-latest`                     |
| `cohere`                  | `COHERE_API_KEY`                                                           | `command-r-08-2024`                        |
| `groq`                    | `GROQ_API_KEY`                                                             | `llama-3.1-8b-instant`                     |
| `xai`                     | `XAI_API_KEY`                                                              | `grok-2-latest`                            |
| `deepseek`                | `DEEPSEEK_API_KEY`                                                         | `deepseek-chat`                            |

All supported provider SDKs ship with the plugin — once you run `sf plugins install sf-git-ai-meta-insights`, no extra `npm install` is needed to switch between OpenAI, Anthropic, Google, Bedrock, Mistral, Cohere, Groq, xAI, or DeepSeek. Just set the env vars for whichever provider you want to use.

#### Common env vars

| Variable                                         | Purpose                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`                                   | Explicit provider id from the table above.                                                                                |
| `LLM_MODEL`                                      | Overrides the per-provider default model id (also settable per-run via `--model`).                                        |
| `OPENAI_BASE_URL` / `LLM_BASE_URL`               | Base URL for an OpenAI-compatible gateway; presence alone auto-selects the `openai-compatible` provider.                  |
| `OPENAI_DEFAULT_HEADERS` / `LLM_DEFAULT_HEADERS` | JSON object of extra headers merged onto OpenAI / OpenAI-compatible requests. `LLM_*` overrides `OPENAI_*` key-by-key.    |
| `OPENAI_MAX_DIFF_CHARS` / `LLM_MAX_DIFF_CHARS`   | Max size of unified diff text sent to the model (default ~120k characters). Also settable per-run via `--max-diff-chars`. |

> `LLM_*` variants override their `OPENAI_*` counterparts when both are set.
> For the full list of supported environment variables, see the [`@mcarvin/smart-diff` documentation](https://github.com/mcarvin8/smart-diff#provider-configuration).

#### Example: native OpenAI

```powershell
$env:OPENAI_API_KEY = "sk-..."
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

#### Example: Anthropic Claude

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
sf sgai metadata summarize --from HEAD~1 --to HEAD --model claude-3-5-sonnet-latest
```

#### Example: company-managed OpenAI-compatible gateway

```powershell
$env:LLM_BASE_URL = "https://llm-gateway.mycompany.example/v1"
$env:LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer <token>","x-tenant-id":"salesforce"}'
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

## Built With

The plugin's core logic is imported from the [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff) library, a general-purpose tool that turns git diffs from any repository into Markdown summaries using any Vercel AI SDK provider.

## License

MIT
