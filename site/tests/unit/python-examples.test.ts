import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The object-oriented walkthroughs contain code. Every ```python block on a page is run, in order, as one
// program, and the page's own `assert` lines are the test. If the code on a page stops working, this fails.

const dir = path.resolve(__dirname, '../../content/extras');
const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).filter((f) => /```python/.test(fs.readFileSync(path.join(dir, f), 'utf8')));

function findPython(): string | null {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return cmd;
  }
  return null;
}
const python = findPython();

describe('code examples in the walkthroughs', () => {
  it('there are examples to test', () => {
    expect(pages.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of pages) {
    it.skipIf(!python)(`${file} runs and its assertions hold`, () => {
      const md = fs.readFileSync(path.join(dir, file), 'utf8');
      const code = [...md.matchAll(/```python[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n\n');
      expect(code.trim().length).toBeGreaterThan(0);
      const tmp = path.join(os.tmpdir(), `primer-example-${process.pid}-${file}.py`);
      fs.writeFileSync(tmp, code);
      try {
        execFileSync(python!, [tmp], { encoding: 'utf8', timeout: 20_000, stdio: 'pipe' });
      } catch (e) {
        const err = e as { stderr?: string };
        throw new Error(`${file} failed:\n${err.stderr ?? e}`);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    });
  }
});
