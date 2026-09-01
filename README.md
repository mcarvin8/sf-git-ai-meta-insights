# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights)
[![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)
[![codecov](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights/graph/badge.svg?token=N5FKE0JPHN)](https://codecov.io/gh/mcarvin8/sf-git-ai-meta-insights)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fmcarvin8%2Fsf-git-ai-meta-insights%2Fmain)](https://dashboard.stryker-mutator.io/reports/github.com/mcarvin8/sf-git-ai-meta-insights/main)

Generates AI-written Markdown summaries of Salesforce metadata changes between two Git refs. Supports OpenAI, Anthropic, Google Gemini, Amazon Bedrock, Mistral, Cohere, Groq, xAI, DeepSeek, and any OpenAI-compatible gateway. Available as a **Salesforce CLI plugin** and as a **native GitHub Action** for GitHub Actions users who want to skip installing the CLI.

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>

  - [Salesforce CLI](#salesforce-cli)
  - [GitHub Action](#github-action)
  - [Provider configuration](#provider-configuration)
  - [Use cases](#use-cases)
  - [How it works](#how-it-works)
  - [License](#license)
</details>

---

## Salesforce CLI

### Requirements

- Salesforce CLI (`sf`)
- Node.js 22.22.1 or later
- A Salesforce DX project with `sfdx-project.json` at the repo root (unless you supply all paths via `--include-package-directory`)
- An LLM provider — see [Provider configuration](#provider-configuration)
- No local Git binary required - the git repository is read directly via [`@scolladon/tsgit`](https://github.com/scolladon/tsgit), a pure-TypeScript git implementation with zero native dependencies

### Quick start

```bash
# Install
sf plugins install sf-git-ai-meta-insights@latest

# OpenAI
export OPENAI_API_KEY="sk-..."
sf sgai metadata summarize --from HEAD~1

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
sf sgai metadata summarize --from HEAD~1 --model claude-3-5-sonnet-latest
```

Output defaults to `metadata-summary.md` in the current directory.

### CLI Command Reference

<!-- commands -->
* [`sf sgai metadata summarize`](#sf-sgai-metadata-summarize)

## `sf sgai metadata summarize`

Generate an AI-powered summary of changed Salesforce metadata from a git diff.

```
USAGE
  $ sf sgai metadata summarize -f <value> [--json] [--flags-dir <value>] [-t <value>] [-m <value>...] [-e <value>...] [-i
    <value>...] [-x <value>...] [--team <value>] [-p <value>] [--model <value>] [--max-diff-chars <value>]
    [--context-lines <value>] [--ignore-whitespace] [--strip-diff-preamble] [--max-hunk-lines <value>]
    [--exclude-default-noise] [--map-reduce] [--redact-secrets] [--max-retries <value>] [-b]

FLAGS
  -b, --merge-base                            Resolve `--from` as the merge base of `--to` and `--from`, instead of
                                              using it directly.
  -e, --commit-message-exclude=<value>...     Exclude commits whose messages match any of these regular expressions
                                              (OR).
  -f, --from=<value>                          (required) Start reference for the git diff range.
  -i, --include-package-directory=<value>...  Additional package directories to include in the diff.
  -m, --commit-message-include=<value>...     Include commits whose messages match any of these regular expressions
                                              (OR).
  -p, --output=<value>                        [default: metadata-summary.md] Output file path for the generated summary.
  -t, --to=<value>                            End reference for the git diff range.
  -x, --exclude-package-directory=<value>...  Package directories to exclude from the diff.
      --context-lines=<value>                 Number of context lines around each change in the unified diff.
      --exclude-default-noise                 Merge smart-diff's built-in "noise" exclude list into the excluded paths.
      --ignore-whitespace                     Ignore whitespace-only changes when building the diff.
      --map-reduce                            Split oversized diffs into per-file batches instead of truncating.
      --max-diff-chars=<value>                Maximum size of the unified diff sent to the LLM (characters).
      --max-hunk-lines=<value>                Cap the body of each diff hunk; anything past the limit is elided.
      --max-retries=<value>                   Retry count for transient LLM call failures.
      --model=<value>                         Chat model id used for the summary.
      --redact-secrets                        Mask likely secrets/credentials in the diff before sending it to the LLM.
      --strip-diff-preamble                   Strip low-value `diff --git`/`index`/`mode`/`similarity`/`rename`/`copy`
                                              lines from the unified diff.
      --team=<value>                          Optional team or squad label for the summary.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Generate an AI-powered summary of changed Salesforce metadata from a git diff.

  Summarize metadata changes between two Git refs using any of the supported LLM providers — OpenAI, Anthropic, Google
  Gemini, Amazon Bedrock, Mistral, Cohere, Groq, xAI, DeepSeek, or any OpenAI-compatible gateway. A configured provider
  (API key, base URL, and/or default headers) is required — see the README for environment variables. Optionally filter
  commits by include/exclude message regexes, narrow paths with `--include-package-directory` /
  `--exclude-package-directory`, and write the model output to a markdown file.

EXAMPLES
  $ sf sgai metadata summarize --from HEAD~5 --to HEAD --commit-message-include "(feature|fix)" --output changes.md

  $ sf sgai metadata summarize --from HEAD~5 --to HEAD --commit-message-include "feat" --commit-message-exclude "wip" --exclude-package-directory force-app/main/default/lwc/temp

  $ sf sgai metadata summarize --team "Revenue Cloud" --from release/cut --to HEAD

  $ sf sgai metadata summarize --from abc1234 --to HEAD

  $ sf sgai metadata summarize --from HEAD~5 --to HEAD --ignore-whitespace --context-lines 1 --strip-diff-preamble --max-hunk-lines 400

  $ sf sgai metadata summarize --from HEAD~20 --to HEAD --max-diff-chars 20000 --map-reduce

  $ sf sgai metadata summarize --from HEAD~1 --redact-secrets

  $ sf sgai metadata summarize --to develop --from main --merge-base

FLAG DESCRIPTIONS
  -b, --merge-base  Resolve `--from` as the merge base of `--to` and `--from`, instead of using it directly.

    When set, the start of the diff range is resolved as the merge base of `--to` and `--from`, e.g. `--to develop
    --from main --merge-base` is equivalent to `--from $(git merge-base develop main) --to develop`, resolved in-process
    with no local git binary required. Defaults to false, in which case `--from` is used as-is.

  -e, --commit-message-exclude=<value>...  Exclude commits whose messages match any of these regular expressions (OR).

    If a commit message matches any exclude pattern, that commit is dropped before the diff is built. Can be set
    multiple times. Applied after include matching when both are set. Use `-e` / `--commit-message-exclude` once per
    pattern.

  -f, --from=<value>  Start reference for the git diff range.

    A git commit hash or ref for the beginning of the diff range (for example a merge base, tag, or explicit commit).
    Always required. Combine with `--merge-base` to resolve this ref as a merge base instead of using it directly.

  -i, --include-package-directory=<value>...  Additional package directories to include in the diff.

    Repo-relative paths (forward slashes), merged with package directories read from `sfdx-project.json` after
    `--exclude-package-directory` is applied. Use to add directories that are not listed in `sfdx-project.json`, or to
    supply the only include paths when the project file is missing or empty (pass at least one value). Use `-i` /
    `--include-package-directory` once per path.

  -m, --commit-message-include=<value>...  Include commits whose messages match any of these regular expressions (OR).

    Each pattern is matched case-insensitively against the full commit message. If any pattern matches, the commit is
    included (unless excluded by `--commit-message-exclude`). Use `-m` / `--commit-message-include` once per pattern;
    the flag may be repeated.

  -p, --output=<value>  Output file path for the generated summary.

    The path to the markdown file where the AI summary is written. Defaults to metadata-summary.md.

  -t, --to=<value>  End reference for the git diff range.

    A git commit hash or ref to use as the end of the diff range. Defaults to HEAD.

  -x, --exclude-package-directory=<value>...  Package directories to exclude from the diff.

    Repo-relative paths (forward slashes). Each value removes matching entries from the `sfdx-project.json` package list
    (same as the former `--ignore-package-directory` behavior) and is also passed to the underlying git diff as an
    excluded pathspec (`:(exclude)path`), so you can drop whole packages or narrow out subtrees (for example generated
    folders under a package). Repeatable; `-x` is a short form.

  --context-lines=<value>  Number of context lines around each change in the unified diff.

    Sets `git diff -U<n>` when building the unified diff sent to the model. Lower values (1 or 0) are typically the
    single biggest token saver on modification-heavy diffs because they drop unchanged surrounding lines from each hunk.
    The structured diff summary (file counts and line totals) still reflects the full change. Allowed range is 0 through
    1000 when set. When omitted, git's default (3) is used.

  --exclude-default-noise  Merge smart-diff's built-in "noise" exclude list into the excluded paths.

    When set, the plugin merges smart-diff's `DEFAULT_NOISE_EXCLUDES` list (lockfiles, `dist`, `build`, `out`,
    `coverage`, `node_modules`, `__snapshots__`) into the set of excluded pathspecs passed to git. This is additive with
    any `--exclude-package-directory` values you provide. Defaults to false, because Salesforce DX repos rarely contain
    these folders inside package directories; enable it if your repo does.

  --ignore-whitespace  Ignore whitespace-only changes when building the diff.

    Passes `-w` / `--ignore-all-space` to `git diff` so pure-whitespace hunks don't consume tokens in the unified diff.
    This is also applied to the `--numstat` and `--name-status` calls used for the structured summary so file counts and
    line totals stay consistent with the diff text. Useful for Salesforce metadata XML where formatting churn is common.
    Defaults to false.

  --map-reduce  Split oversized diffs into per-file batches instead of truncating.

    By default, a diff over `--max-diff-chars` is hard-truncated and a notice is prepended to the summary. When set, an
    oversized diff is instead split into per-file batches, each summarized independently, then synthesized into one
    final summary. This costs one extra LLM call per batch plus a reduce call, so it is slower and more expensive than a
    single request — use it when preserving coverage of the full diff matters more than latency or cost. No-op when the
    diff already fits within `--max-diff-chars`. Defaults to false.

  --max-diff-chars=<value>  Maximum size of the unified diff sent to the LLM (characters).

    Large metadata diffs can exceed the model context window. The plugin sends at most this many characters of the
    unified diff (plus a fixed preamble). Allowed range is 5000 through 5000000 when set. Defaults to a conservative
    limit when unset; override with `LLM_MAX_DIFF_CHARS` or this flag. Only increase if your model and gateway support a
    larger context.

  --max-hunk-lines=<value>  Cap the body of each diff hunk; anything past the limit is elided.

    Limits the number of body lines retained per `@@` hunk in the unified diff. Lines past the limit are replaced with a
    single elision marker so the `@@` header and the structured diff summary totals are preserved. Use this to prevent a
    single massive hunk (for example a regenerated metadata file) from dominating the LLM prompt. Allowed range is 1
    through 100000 when set. When omitted, hunks are not truncated.

  --max-retries=<value>  Retry count for transient LLM call failures.

    Number of retries for transient LLM call failures such as rate limits, 5xx responses, and network errors. Must be a
    non-negative integer. When omitted, uses `LLM_MAX_RETRIES` if set, otherwise the provider default (2).

  --model=<value>  Chat model id used for the summary.

    Override the chat model used when creating the AI-generated metadata summary. Must be a model id supported by the
    resolved LLM provider (for example `gpt-4o` for OpenAI, `claude-3-5-sonnet-latest` for Anthropic, `gemini-2.0-flash`
    for Google). When omitted, the plugin uses `LLM_MODEL` if set, otherwise the resolved provider's default model.

  --redact-secrets  Mask likely secrets/credentials in the diff before sending it to the LLM.

    Masks values that look like cloud provider keys, VCS/chat tokens, PEM private key blocks, JWTs, `Bearer` headers,
    basic-auth URL passwords, and generic `KEY=value` assignments before the diff text is sent to the model. Useful for
    Salesforce metadata that can carry secrets in Custom Settings, Named Credentials, or scratch org config. Defaults to
    false.

  --strip-diff-preamble

    Strip low-value `diff --git`/`index`/`mode`/`similarity`/`rename`/`copy` lines from the unified diff.

    When set, removes the per-file git diff preamble lines that contain almost no semantic information (`diff --git`,
    `index`, `new file mode`, `deleted file mode`, `old mode`, `new mode`, `similarity index`, `dissimilarity index`,
    `rename from`/`rename to`, `copy from`/`copy to`). The `--- a/…`, `+++ b/…`, and `@@` hunk headers are preserved so
    the model can still attribute changes to files. Defaults to false.

  --team=<value>  Optional team or squad label for the summary.

    When set, includes a team line in the LLM user prompt. If omitted, `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM` is used
    when set; otherwise no team is included.
```

_See code: [src/commands/sgai/metadata/summarize.ts](https://github.com/mcarvin8/sf-git-ai-meta-insights/blob/v5.2.0/src/commands/sgai/metadata/summarize.ts)_
<!-- commandsstop -->

## GitHub Action

### Requirements

- No Salesforce CLI or plugin install required - the Action bundles the same core logic as a standalone `node24` Action
- A Salesforce DX project with `sfdx-project.json` in the checked-out repo (or supply `include-package-directory`)
- An LLM provider credential set as a step-level `env` var — see [Provider configuration](#provider-configuration)

### Usage

```yaml
- name: Summarize metadata changes
  uses: mcarvin8/sf-git-ai-meta-insights@v5
  with:
    from: HEAD~1
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Inputs

| Input                        | Description                                                                                | Required | Default               |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------- | ---------------------- |
| `from`                        | Start reference for the git diff range.                                                       | Yes      |                         |
| `to`                           | End reference for the git diff range.                                                         | No       | `HEAD`                  |
| `merge-base`                   | Resolve `from` as the merge base of `to` and `from`, instead of using it directly.             | No       | `false`                 |
| `commit-message-include`        | Regular expressions to include commits by message (OR), one per line.                         | No       |                         |
| `commit-message-exclude`        | Regular expressions to exclude commits by message (OR), one per line.                         | No       |                         |
| `include-package-directory`      | Additional package directories to include in the diff, one per line.                          | No       |                         |
| `exclude-package-directory`      | Package directories to exclude from the diff, one per line.                                   | No       |                         |
| `team`                         | Optional team or squad label for the summary.                                                 | No       |                         |
| `output`                       | Output file path for the generated summary.                                                   | No       | `metadata-summary.md`   |
| `model`                        | Chat model id used for the summary.                                                            | No       |                         |
| `max-diff-chars`                | Maximum size of the unified diff sent to the LLM (characters).                                | No       |                         |
| `context-lines`                 | Number of context lines around each change in the unified diff.                               | No       |                         |
| `ignore-whitespace`             | Ignore whitespace-only changes when building the diff.                                        | No       | `false`                 |
| `strip-diff-preamble`           | Strip low-value `diff --git`/`index`/`mode`/`similarity`/`rename`/`copy` lines from the diff.  | No       | `false`                 |
| `max-hunk-lines`                | Cap the body of each diff hunk; anything past the limit is elided.                            | No       |                         |
| `exclude-default-noise`         | Merge smart-diff's built-in noise exclude list into the excluded paths.                       | No       | `false`                 |
| `map-reduce`                   | Split oversized diffs into per-file batches instead of truncating.                             | No       | `false`                 |
| `redact-secrets`                | Mask likely secrets/credentials in the diff before sending it to the LLM.                     | No       | `false`                 |
| `max-retries`                   | Retry count for transient LLM call failures.                                                  | No       |                         |

### Outputs

| Output                | Description                                             |
| ----------------------- | ----------------------------------------------------------- |
| `summary-path`          | Path to the generated Markdown summary file.               |
| `request-count`         | Number of LLM requests made while generating the summary.   |
| `input-tokens`          | LLM input tokens consumed.                                  |
| `output-tokens`         | LLM output tokens consumed.                                 |
| `cached-input-tokens`    | LLM cached input tokens consumed.                            |
| `total-tokens`          | Total LLM tokens consumed.                                   |

### Example: deploy-summary comment on a PR

```yaml
- name: Summarize metadata changes
  id: summarize
  uses: mcarvin8/sf-git-ai-meta-insights@v5
  with:
    from: ${{ github.event.pull_request.base.sha }}
    include-package-directory: force-app
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Post summary to PR
  run: gh pr comment "$PR_NUMBER" --body-file "${{ steps.summarize.outputs.summary-path }}"
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    PR_NUMBER: ${{ github.event.pull_request.number }}
```

## Provider configuration

Provider resolution is handled by [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff). Set credentials for whichever provider you want to use. If multiple providers are configured, set `LLM_PROVIDER` to pick one explicitly; otherwise the resolver auto-detects from env vars.

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
| `LLM_PROVIDER_NAME`                              | Display name used when `openai-compatible` is active (defaults to `openai-compatible`).                        |
| `OPENAI_MAX_DIFF_CHARS` / `LLM_MAX_DIFF_CHARS`   | Max unified diff characters sent to the model (default ~120k). Also settable via `--max-diff-chars`.           |
| `OPENAI_MAX_TOKENS` / `LLM_MAX_TOKENS`           | Max completion tokens (default 4000).                                                                          |
| `LLM_TEMPERATURE`                                | Sampling temperature, clamped to 0–2 (default 0.2). Lower = more deterministic, higher = more varied prose.    |
| `LLM_MAX_RETRIES`                                | Retry count for transient LLM call failures (rate limits, 5xx, network errors). Default 2; `0` disables retries. |

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

## Use cases

### A) Audit production deployments over a time period

After deploying to production from `main`, generate a summary of all Salesforce metadata changes landed in the last week. Useful for change audits, release notes, or team standup reports.

```bash
# Find the commit on main from 1 week ago
FROM=$(git log origin/main -1 --before="1 week ago" --pretty=format:%H)

# Summarize everything deployed since then
sf sgai metadata summarize --from "$FROM" --to origin/main --output weekly-release-notes.md
```

Add `--team "Platform Team"` to label the summary, or `--commit-message-include "(deploy|release)"` to filter to deployment commits only.

### B) Review a GitHub PR or GitLab MR before merging

Before merging and deploying a PR or MR, generate an AI summary of the Salesforce metadata it introduces. Useful for code review, impact analysis, or pre-deployment sign-off.

**GitHub PR** — use the [GitHub Action](#github-action) and post the summary as a sticky PR comment using [`marocchino/sticky-pull-request-comment`](https://github.com/marocchino/sticky-pull-request-comment):

```yaml
- name: Summarize metadata changes
  uses: mcarvin8/sf-git-ai-meta-insights@v5
  with:
    from: origin/main
    to: ${{ github.sha }}
    output: pr-impact.md
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Post metadata summary as PR comment
  if: always() && github.event_name == 'pull_request'
  uses: marocchino/sticky-pull-request-comment@v3
  with:
    header: metadata-impact
    path: pr-impact.md
```

The comment is created on first run and updated (not duplicated) on subsequent pushes to the same PR.

**GitLab MR** — no native Action support on GitLab, so use the CLI directly with your MR's source branch:

```bash
git fetch origin
sf sgai metadata summarize --from origin/main --to origin/your-mr-branch --output mr-impact.md
```

Post the generated `mr-impact.md` as an MR note via the [GitLab API](https://docs.gitlab.com/ee/api/notes.html) or your preferred CI comment action.

## How it works

The plugin reads `packageDirectories` from `sfdx-project.json` to scope the diff, merges any CLI include/exclude paths, then sends the structured diff context to the configured model. Core logic is provided by [`@mcarvin/smart-diff`](https://github.com/mcarvin8/smart-diff), a general-purpose library that turns git diffs into AI generated markdown summaries.

After writing the summary file, the command logs LLM usage (request count, input/output/cached/total tokens) to help track model spend.

## License

[MIT](LICENSE.md)
