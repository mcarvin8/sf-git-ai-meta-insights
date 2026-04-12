# summary

Generate an AI-powered summary of changed Salesforce metadata from a git diff.

# description

Analyze metadata changes between two Git refs, optionally filter by commit message regex, and write an AI summary to a markdown file.

# flags.from.summary

Start reference for the git diff range.

# flags.from.description

A git commit hash or ref to use as the beginning of the diff range. Defaults to HEAD~1.

# flags.to.summary

End reference for the git diff range.

# flags.to.description

A git commit hash or ref to use as the end of the diff range. Defaults to HEAD.

# flags.message-filter.summary

Regex filter for commit messages.

# flags.message-filter.description

Only include commits whose messages match this regular expression when generating the diff summary.

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

# examples

- <%= config.bin %> <%= command.id %> --from HEAD~5 --to HEAD --message-filter "(feature|fix)" --output changes.md
