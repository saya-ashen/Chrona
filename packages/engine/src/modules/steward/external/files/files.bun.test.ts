import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFiles } from './files';

test('concurrent mutations preserve complete file bytes and history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chrona-files-concurrent-'));
  const content = join(dir, 'content');
  await mkdir(content);
  const files = createFiles(content, join(dir, 'data'));
  const at = '2026-11-16T00:00:00Z', path = 'same.txt';
  const write = (value: string) => files.tool('write', { path, content: value }, at);
  try {
    expect(await Promise.all([write('ABCDEFGHIJ'), write('x')])).toEqual([{ ok: true }, { ok: true }]);
    expect(await readFile(join(content, path), 'utf8')).toBe('x');
    const history = await files.tool('history', { path }, at) as { versions: { version: string }[] };
    expect(history.versions).toHaveLength(2);
    expect(await Promise.all([
      write('third'), files.tool('restore', { path, version: history.versions[0]!.version }, at),
    ])).toEqual([{ ok: true }, { ok: true }]);
    expect(await readFile(join(content, path), 'utf8')).toBe('ABCDEFGHIJ');
    const final = await files.tool('history', { path }, at) as { versions: unknown[] };
    expect(final.versions).toHaveLength(4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
