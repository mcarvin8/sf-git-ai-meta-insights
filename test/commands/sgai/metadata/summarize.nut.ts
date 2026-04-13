import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { shouldUseLlmGateway } from '@mcarvin/smart-diff';
import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';

/** TestSession + git setup often exceeds Jest's default 5s hook timeout on CI and Windows. */
const NUT_TIMEOUT_MS = 120_000;

/** Same gate as `sgai metadata summarize`: needs API key, base URL, or LLM default headers. */
const canCallLlm = shouldUseLlmGateway();

(canCallLlm ? describe : describe.skip)('sgai metadata summarize NUT', () => {
  let session: TestSession;

  beforeAll(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'NONE' });
    const projectRoot = session.dir;
    await writeFile(
      join(projectRoot, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }, null, 2),
      'utf8'
    );
    await mkdir(join(projectRoot, 'force-app', 'main', 'default', 'classes'), { recursive: true });
    await writeFile(
      join(projectRoot, 'force-app', 'main', 'default', 'classes', 'MyClass.cls'),
      'public class MyClass {}',
      'utf8'
    );

    execSync('git init', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git add .', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: projectRoot, stdio: 'pipe' });

    await writeFile(
      join(projectRoot, 'force-app', 'main', 'default', 'classes', 'MyClass.cls'),
      'public class MyClass {\n    // updated\n}\n',
      'utf8'
    );
    execSync('git add .', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git commit -m "Update metadata file"', { cwd: projectRoot, stdio: 'pipe' });
  }, NUT_TIMEOUT_MS);

  afterAll(async () => {
    await session?.clean();
  }, NUT_TIMEOUT_MS);

  it(
    'runs sgai metadata summarize and returns a summary header',
    async () => {
      execCmd('sgai metadata summarize --from HEAD~1 --to HEAD', { cwd: session.dir, ensureExitCode: 0 });
      const summary = await readFile(join(session.dir, 'metadata-summary.md'), 'utf8');
      expect(summary).toContain('# Metadata Change Summary');
    },
    NUT_TIMEOUT_MS
  );
});
