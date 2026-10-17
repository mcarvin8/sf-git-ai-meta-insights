/**
 * Plain `Error` subclass for every failure the summarize core and the GitHub Action can raise.
 *
 * Code reachable from `src/action` must not import `@salesforce/core`: once esbuild bundles it into
 * one file, its pino-based logger tries to start a worker-thread transport by relative file path and
 * crashes at runtime (`unable to determine transport target`). The CLI command still reports these
 * errors normally, because `SfCommand` wraps thrown errors and keeps their name and message.
 */
export class SgaiError extends Error {
  public constructor(message: string, { name, cause }: { name: string; cause?: unknown }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = name;
  }
}
