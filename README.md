# sf-git-ai-meta-insights

[![NPM](https://img.shields.io/npm/v/sf-git-ai-meta-insights.svg?label=sf-git-ai-meta-insights)](https://www.npmjs.com/package/sf-git-ai-meta-insights) [![Downloads/week](https://img.shields.io/npm/dw/sf-git-ai-meta-insights.svg)](https://npmjs.org/package/sf-git-ai-meta-insights) [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://raw.githubusercontent.com/salesforcecli/sf-git-ai-meta-insights/main/LICENSE.md)

`sf-git-ai-meta-insights` is an `sf` plugin that generates AI-assisted summaries of Salesforce metadata changes from a git diff.

## Overview

This plugin analyzes metadata changes between two Git refs, optionally filters commits by message, and writes a Markdown summary file. When an `OPENAI_API_KEY` is available, it uses OpenAI to generate a richer description; otherwise it falls back to a local summary.

## Installation

```bash
sf plugins install sf-git-ai-meta-insights@latest
```

## Command

### `sf sgai metadata analyze`

Analyze metadata changes between two Git refs and write the generated summary to a Markdown file.

#### Flags

- `--from` `-f` Start reference for the git diff range. Defaults to `HEAD~1`.
- `--to` `-t` End reference for the git diff range. Defaults to `HEAD`.
- `--message-filter` `-m` Regex filter for commit messages.
- `--output` `-o` Output file path for the generated summary. Defaults to `metadata-summary.md`.
- `--model` OpenAI model used for the summary. Defaults to `gpt-4o-mini`.
- `--ignore-package-directory` `-i` Ignore package directories defined in `sfdx-project.json`. This flag may be provided multiple times.

#### Examples

Generate a summary for the last commit range:

```bash
sf sgai metadata analyze
```

Generate a summary for a custom commit range and save it to `changes.md`:

```bash
sf sgai metadata analyze --from HEAD~5 --to HEAD --output changes.md
```

Generate a summary filtered by commit message content:

```bash
sf sgai metadata analyze --message-filter "(feature|fix)"
```

Use a custom OpenAI model:

```bash
sf sgai metadata analyze --model gpt-4o-mini
```

## Requirements

- `sf` CLI installed
- Node.js 18 or later
- A Salesforce DX project repository with a `sfdx-project.json` file present in the repo root
- Optional: `OPENAI_API_KEY` environment variable for AI-generated summaries

This plugin depends on running inside an SFDX project because it reads `packageDirectories` from `sfdx-project.json`.

If `OPENAI_API_KEY` is not set, the plugin still generates a local fallback summary.

## License

MIT
