# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights)
[![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)
[![codecov](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights/graph/badge.svg?token=N5FKE0JPHN)](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fmcarvin8%2Fsf-git-ai-meta-insights%2Fmain)](https://dashboard.stryker-mutator.io/reports/github.com/mcarvin8/sf-git-ai-meta-insights/main)

Salesforce CLI plugin that generates AI-written Markdown summaries of metadata changes between two Git refs. Supports every LLM provider in the [Vercel AI SDK](https://sdk.vercel.ai): OpenAI, Anthropic, Google Gemini, Amazon Bedrock, Mistral, Cohere, Groq, xAI, DeepSeek, and any OpenAI-compatible gateway.

![Markdown Summary Example](https://raw.githubusercontent.com/mcarvin8/sf-git-ai-meta-insights/main/.github/images/summary-example.png)

## Requirements

- Salesforce CLI (`sf`)
- Node.js 20+
- A Salesforce DX project with `sfdx-project.json` at the repo root (unless you supply all paths via `--include-package-directory`)
- An LLM provider — see [Provider configuration](#provider-configuration)

No system Git installation required. The plugin uses a bundled Git binary via [dugite](https://github.com/desktop/dugite).

### Alpine Linux

Dugite's bundled binary is compiled against glibc and will not run on Alpine Linux or other musl-based images. Point dugite at your system Git instead by setting these two env vars:

| Variable              | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `LOCAL_GIT_DIRECTORY` | Root of your Git installation (the directory containing `bin/git`)     |
| `GIT_EXEC_PATH`       | Directory containing Git's subprograms (set if your distro moves them) |

```sh
export LOCAL_GIT_DIRECTORY=/usr        # uses /usr/bin/git
export GIT_EXEC_PATH=/usr/lib/git-core # only needed if subprograms are non-standard
```

Install Git in your image first if needed (`apk add git`). No code changes required.

## Installation

```bash
sf plugins install sf-git-ai-meta-insights@latest
```

No extra `npm install` needed. All supported provider SDKs ship with the plugin.

## Quick start

Set a provider credential, then run:

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."
sf sgai metadata summarize --from HEAD~1

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
sf sgai metadata summarize --from HEAD~1 --model claude-3-5-sonnet-latest
```

Output defaults to `metadata-summary.md` in the current directory.

## Command

### `sf sgai metadata summarize`

Diffs Salesforce metadata between two Git refs, optionally filters commits by message, and writes an AI-generated Markdown summary.

#### Flags

| Flag                          | Short | Required | Default               | Description                                                                                                                                    |
| ----------------------------- | ----- | -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from`                      | `-f`  | **Yes**  |                       | Start ref for the diff range (e.g. `HEAD~1`, a tag, or a commit hash).                                                                         |
| `--to`                        | `-t`  | No       | `HEAD`                | End ref for the diff range.                                                                                                                    |
| `--commit-message-include`    | `-m`  | No       |                       | Include only commits whose messages match these regex patterns (repeatable, OR logic).                                                         |
| `--commit-message-exclude`    | `-e`  | No       |                       | Exclude commits whose messages match these regex patterns (repeatable, OR logic).                                                              |
| `--include-package-directory` | `-i`  | No       |                       | Extra repo-relative package paths merged with `sfdx-project.json` directories (repeatable).                                                    |
| `--exclude-package-directory` | `-x`  | No       |                       | Paths to remove from the configured list; also adds `:(exclude)` pathspecs to the diff (repeatable).                                           |
| `--team`                      |       | No       |                       | Team or squad label shown in the summary. Also settable via `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM`.                                         |
| `--output`                    | `-p`  | No       | `metadata-summary.md` | Output file path.                                                                                                                              |
| `--model`                     |       | No       | _provider default_    | Chat model ID. Overrides the provider default (e.g. `gpt-4o-mini`, `claude-3-5-haiku-latest`). Also settable via `LLM_MODEL`.                  |
| `--max-diff-chars`            |       | No       |                       | Max characters of unified diff text sent to the model (5,000–5,000,000).                                                                       |
| `--context-lines`             |       | No       | `3` (git default)     | Lines of context around each change (`-U<n>`). Lower values reduce token usage on large diffs.                                                 |
| `--ignore-whitespace`         |       | No       | `false`               | Pass `-w` to `git diff` to skip whitespace-only changes. Applied to both the unified diff and `--numstat`/`--name-status`.                     |
| `--strip-diff-preamble`       |       | No       | `false`               | Remove low-signal `diff --git`, `index`, `mode`, `similarity`, `rename`, and `copy` lines. Hunk headers (`--- a/…`, `+++ b/…`, `@@`) are kept. |
| `--max-hunk-lines`            |       | No       |                       | Cap each hunk body at N lines (1–100,000); excess is replaced with a single elision marker. Hunk headers and change counts stay intact.        |
| `--exclude-default-noise`     |       | No       | `false`               | Exclude common noise paths: lockfiles, `dist`, `build`, `out`, `coverage`, `node_modules`, `__snapshots__`.                                    |

#### Examples

Summarize changes since the previous commit:

```bash
sf sgai metadata summarize --from HEAD~1
```

Summarize changes from the past week on `main`:

```bash
FROM=$(git log origin/main -1 --before="1 week ago" --pretty=format:%H)
sf sgai metadata summarize --from "$FROM" --to origin/main
```

Save output to a custom file:

```bash
sf sgai metadata summarize --from HEAD~5 --to HEAD --output changes.md
```

Include only commits matching a pattern:

```bash
sf sgai metadata summarize --from main --to HEAD --commit-message-include "(feature|fix)"
```

Override the model:

```bash
sf sgai metadata summarize --from HEAD~1 --model claude-3-5-sonnet-latest
```

Reduce LLM token cost by shaping the diff:

```bash
sf sgai metadata summarize \
  --from HEAD~5 --to HEAD \
  --ignore-whitespace \
  --context-lines 1 \
  --strip-diff-preamble \
  --max-hunk-lines 400
```

> The diff-shaping flags only affect the text sent to the model. The structured change inventory (file counts, additions, deletions) is computed separately and is always accurate. See the [`@mcarvin/smart-diff` "Reducing tokens" guide](https://github.com/mcarvin8/smart-diff#reducing-tokens) for details.

## Provider configuration

Provider resolution is handled by [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff) via the Vercel AI SDK. Set credentials for whichever provider you want to use. If multiple providers are configured, set `LLM_PROVIDER` to pick one explicitly; otherwise the resolver auto-detects from env vars.

| Provider (`LLM_PROVIDER`) | Credential env vars                                                               | Default model                              |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| `openai`                  | `OPENAI_API_KEY` or `LLM_API_KEY`                                                 | `gpt-4o-mini`                              |
| `openai-compatible`       | `LLM_BASE_URL` or `OPENAI_BASE_URL` (required); optional API key / custom headers | `gpt-4o-mini`                              |
| `anthropic`               | `ANTHROPIC_API_KEY`                                                               | `claude-3-5-haiku-latest`                  |
| `google`                  | `GOOGLE_GENERATIVE_AI_API_KEY` or `GOOGLE_API_KEY`                                | `gemini-2.0-flash`                         |
| `bedrock`                 | Standard AWS credential chain (env / profile / role)                              | `anthropic.claude-3-5-haiku-20241022-v1:0` |
| `mistral`                 | `MISTRAL_API_KEY`                                                                 | `mistral-small-latest`                     |
| `cohere`                  | `COHERE_API_KEY`                                                                  | `command-r-08-2024`                        |
| `groq`                    | `GROQ_API_KEY`                                                                    | `llama-3.1-8b-instant`                     |
| `xai`                     | `XAI_API_KEY`                                                                     | `grok-2-latest`                            |
| `deepseek`                | `DEEPSEEK_API_KEY`                                                                | `deepseek-chat`                            |

### Common env vars

| Variable                                         | Purpose                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`                                   | Explicit provider ID from the table above.                                                                     |
| `LLM_MODEL`                                      | Overrides the provider's default model. Also settable per-run via `--model`.                                   |
| `OPENAI_BASE_URL` / `LLM_BASE_URL`               | Base URL for an OpenAI-compatible gateway. Presence alone auto-selects the `openai-compatible` provider.       |
| `OPENAI_DEFAULT_HEADERS` / `LLM_DEFAULT_HEADERS` | JSON object of extra headers for OpenAI / OpenAI-compatible requests. `LLM_*` overrides `OPENAI_*` key-by-key. |
| `OPENAI_MAX_DIFF_CHARS` / `LLM_MAX_DIFF_CHARS`   | Max unified diff characters sent to the model (default ~120k). Also settable via `--max-diff-chars`.           |

`LLM_*` variants override their `OPENAI_*` counterparts when both are set. For the full env var reference, see the [`@mcarvin/smart-diff` documentation](https://github.com/mcarvin8/smart-diff#provider-configuration).

### Provider examples

**OpenAI**

```powershell
$env:OPENAI_API_KEY = "sk-..."
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

**Anthropic Claude**

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
sf sgai metadata summarize --from HEAD~1 --to HEAD --model claude-3-5-sonnet-latest
```

**Company-managed OpenAI-compatible gateway**

```powershell
$env:LLM_BASE_URL = "https://llm-gateway.mycompany.example/v1"
$env:LLM_DEFAULT_HEADERS = '{"Authorization":"Bearer <token>","x-tenant-id":"salesforce"}'
sf sgai metadata summarize --from HEAD~1 --to HEAD
```

## How it works

The plugin reads `packageDirectories` from `sfdx-project.json` to scope the diff, merges any CLI include/exclude paths, then sends the structured diff context to the configured model. Core logic is provided by [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff), a general-purpose library that turns git diffs into Markdown summaries using any Vercel AI SDK provider.

## License

[MIT](LICENSE.md)
