# summary

Generate an AI-powered summary of changed Salesforce metadata from a git diff.

# description

Summarize metadata changes between two Git refs, optionally filter by commit message regex, and write an AI summary to a markdown file.

# flags.from.summary

Start reference for the git diff range.

# flags.from.description

Required. A git commit hash or ref for the beginning of the diff range (for example a merge base, tag, or explicit commit). You must set this for your platform and workflow; there is no default.

# flags.to.summary

End reference for the git diff range.

# flags.to.description

A git commit hash or ref to use as the end of the diff range. Defaults to HEAD.

# flags.message-filter.summary

Regex filter for commit messages.

# flags.message-filter.description

Only include commits whose messages match this regular expression when generating the diff summary.

# flags.team.summary

Optional team or squad label for the summary.

# flags.team.description

When set, includes a team line in the OpenAI user prompt and a Team section in the local fallback summary. If omitted, `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM` is used when set; otherwise no team is included.

# flags.output.summary

Output file path for the generated summary.

# flags.output.description

The path to the markdown file where the AI summary is written. Defaults to metadata-summary.md.

# flags.model.summary

OpenAI model used for the summary.

# flags.model.description

The OpenAI model to use when creating the AI-generated metadata summary.

# flags.ignore-package-directory.summary

Package directories to ignore when generating the diff.

# flags.ignore-package-directory.description

Specify one or more package directories to exclude from the generated diff. This flag can be provided multiple times.

# flags.max-diff-chars.summary

Maximum size of the unified diff sent to the LLM (characters).

# flags.max-diff-chars.description

Large metadata diffs can exceed the model context window. The plugin sends at most this many characters of the unified diff (plus a fixed preamble). Allowed range is 5000 through 5000000 when set. Defaults to a conservative limit when unset; override with `LLM_MAX_DIFF_CHARS` or this flag. Only increase if your model and gateway support a larger context.

# examples

- <%= config.bin %> <%= command.id %> --from HEAD~5 --to HEAD --message-filter "(feature|fix)" --output changes.md
- <%= config.bin %> <%= command.id %> --team "Revenue Cloud" --from release/cut --to HEAD
- <%= config.bin %> <%= command.id %> --from abc1234 --to HEAD
