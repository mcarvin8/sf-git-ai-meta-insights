# Summarize Salesforce release notes with repository diffs

Use a public Salesforce release notes or documentation URL to help explain a git
metadata diff. This example fetches excerpts from a URL you choose with
[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp), then
passes them to the existing smart-diff summarizer through a `ChatModel` wrapper.
The summary uses your configured LLM provider and includes the documentation
source URL.

Parallel's anonymous HTTP endpoint needs no account or API key for light use.
You still need to configure an LLM provider as described in the repository root
README.

## Run from a clone

Requires Node.js 22.22.1 or newer. From the sf-git-ai-meta-insights checkout:

```bash
npm ci
npm run build
cd examples/sf-release-notes
npm ci
```

Configure your provider in the environment, then select the repository, commit
range and documentation URL. For example, to summarize metadata changes against
Salesforce release notes:

```bash
npm start -- --cwd /path/to/your/repository \
  --from origin/main --to HEAD \
  --url https://help.salesforce.com/s/article/ReleaseNotes
```

`--from` and `--url` are required. `--to` defaults to `HEAD`; `--cwd` defaults to
the current directory. Use a public Salesforce release notes URL appropriate to
what you are reviewing.

Only the selected URL goes to Parallel. Your diff and the retrieved excerpts go
to the LLM provider you configured. Use public documentation URLs without
credentials or private query parameters. Retrieved text is treated as untrusted
reference material, and the model is asked to cite documentation-based claims
and distinguish advice from changes in the patch. Review the output against the
patch and source; this is a summary aid, not an automated compatibility check.

The documentation request has a 30-second deadline. Retrieval errors, rate limits
and empty excerpts stop the example rather than silently producing a summary
without context. Excerpts are capped at 12,000 characters with a truncation notice;
they do not cover the entire document. The existing diff size limit and LLM retry
settings still apply.

Run the example's deterministic transport and summary checks with `npm test`
from this directory, after the setup above.
