# summary

Generate an AI-powered summary of changed Salesforce metadata from a git diff.

# description

Summarize metadata changes between two Git refs using a configured OpenAI-compatible LLM (required—see environment variables below). Optionally filter commits by include/exclude message regexes, narrow paths with `--include-package-directory` / `--exclude-package-directory`, and write the model output to a markdown file.

# errors.noPackageDirectories

No Salesforce package directories were found in `sfdx-project.json` for this repository (or every package directory was excluded). Configure package directories or use `--include-package-directory`.

# errors.noCommitsAfterFilter

No commits remained after applying commit message filters between %s and %s. Include: %s; exclude: %s.

# flags.from.summary

Start reference for the git diff range.

# flags.from.description

Required. A git commit hash or ref for the beginning of the diff range (for example a merge base, tag, or explicit commit). You must set this for your platform and workflow; there is no default.

# flags.to.summary

End reference for the git diff range.

# flags.to.description

A git commit hash or ref to use as the end of the diff range. Defaults to HEAD.

# flags.commit-message-include.summary

Include commits whose messages match any of these regular expressions (OR).

# flags.commit-message-include.description

Each pattern is matched case-insensitively against the full commit message. If any pattern matches, the commit is included (unless excluded by `--commit-message-exclude`). Use `-m` / `--commit-message-include` once per pattern; the flag may be repeated.

# flags.commit-message-exclude.summary

Exclude commits whose messages match any of these regular expressions (OR).

# flags.commit-message-exclude.description

If a commit message matches any exclude pattern, that commit is dropped before the diff is built. Can be set multiple times. Applied after include matching when both are set. Use `-e` / `--commit-message-exclude` once per pattern.

# flags.include-package-directory.summary

Additional package directories to include in the diff.

# flags.include-package-directory.description

Repo-relative paths (forward slashes), merged with package directories read from `sfdx-project.json` after `--exclude-package-directory` is applied. Use to add directories that are not listed in `sfdx-project.json`, or to supply the only include paths when the project file is missing or empty (pass at least one value). Use `-i` / `--include-package-directory` once per path.

# flags.exclude-package-directory.summary

Package directories to exclude from the diff.

# flags.exclude-package-directory.description

Repo-relative paths (forward slashes). Each value removes matching entries from the `sfdx-project.json` package list (same as the former `--ignore-package-directory` behavior) and is also passed to the underlying git diff as an excluded pathspec (`:(exclude)path`), so you can drop whole packages or narrow out subtrees (for example generated folders under a package). Repeatable; `-x` is a short form.

# flags.team.summary

Optional team or squad label for the summary.

# flags.team.description

When set, includes a team line in the OpenAI user prompt. If omitted, `METADATA_AUDIT_TEAM` or `SF_GIT_AI_TEAM` is used when set; otherwise no team is included.

# flags.output.summary

Output file path for the generated summary.

# flags.output.description

The path to the markdown file where the AI summary is written. Defaults to metadata-summary.md.

# flags.model.summary

OpenAI model used for the summary.

# flags.model.description

The OpenAI model to use when creating the AI-generated metadata summary.

# flags.max-diff-chars.summary

Maximum size of the unified diff sent to the LLM (characters).

# flags.max-diff-chars.description

Large metadata diffs can exceed the model context window. The plugin sends at most this many characters of the unified diff (plus a fixed preamble). Allowed range is 5000 through 5000000 when set. Defaults to a conservative limit when unset; override with `LLM_MAX_DIFF_CHARS` or this flag. Only increase if your model and gateway support a larger context.

# examples

- <%= config.bin %> <%= command.id %> --from HEAD~5 --to HEAD --commit-message-include "(feature|fix)" --output changes.md
- <%= config.bin %> <%= command.id %> --from HEAD~5 --to HEAD --commit-message-include "feat" --commit-message-exclude "wip" --exclude-package-directory force-app/main/default/lwc/temp
- <%= config.bin %> <%= command.id %> --team "Revenue Cloud" --from release/cut --to HEAD
- <%= config.bin %> <%= command.id %> --from abc1234 --to HEAD
