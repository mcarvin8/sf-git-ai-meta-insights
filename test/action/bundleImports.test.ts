import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = resolve(repoRoot, 'src/action/index.ts');

/** Every source file reachable from `entry` through relative imports, plus the bare packages it imports. */
function collectImports(entry: string): { files: string[]; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/gm)) {
      if (specifier.startsWith('.')) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
      } else {
        packages.set(specifier, [...(packages.get(specifier) ?? []), file]);
      }
    }
  }
  return { files: [...files], packages };
}

describe('GitHub Action bundle imports', () => {
  const { files, packages } = collectImports(ENTRY);

  it('walks the summarize core and reference-docs modules', () => {
    const relative = files.map((f) => f.slice(repoRoot.length + 1).replace(/\\/g, '/'));
    expect(relative).toEqual(
      expect.arrayContaining([
        'src/action/main.ts',
        'src/metadata/summarizeCore.ts',
        'src/metadata/summarizeHelpers.ts',
        'src/ai/referenceDocs.ts',
        'src/ai/parallelMcpClient.ts',
        'src/salesforce/releaseNotes.ts',
        'src/errors.ts',
      ]),
    );
  });

  it('never imports @salesforce/core, whose logger crashes once bundled', () => {
    const offenders = [...packages.entries()].filter(([name]) => name.startsWith('@salesforce/'));
    expect(offenders).toEqual([]);
  });
});
