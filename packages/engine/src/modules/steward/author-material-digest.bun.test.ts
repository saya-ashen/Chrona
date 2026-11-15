import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { moduleMaterialDigest } from './module-artifacts';
import { packageMaterial } from './external/author/distribution';
import { materialSummary, type MaterialFile } from './external/author/material';

for (const explicit of [false, true]) test(`Author stage digest matches kernel receipt (${explicit ? 'recorded artifacts' : 'source only'})`, () => {
  const files: MaterialFile[] = [{ path: 'module.json', bytes: Buffer.from(JSON.stringify({ name: 'fixture', entry: 'z.ts', tools: [] })) }, { path: 'z.ts', bytes: Buffer.from('source\0bytes') }, { path: 'a.ts', bytes: Buffer.from('source') }];
  if (explicit) {
    const bytes = Buffer.from([0, 255, 1]);
    files.push({ path: 'bin/tool', bytes, executable: true });
    files.push({ path: 'chrona-material.json', bytes: Buffer.from(JSON.stringify({ schema: 1, source: ['module.json', 'a.ts', 'z.ts'], artifacts: [{ path: 'bin/tool', sha256: createHash('sha256').update(bytes).digest('hex'), executable: true }], build: { commands: ['build'], toolchain: 'test', target: 'test' } })) });
  }
  expect(packageMaterial('fixture', files, { kind: 'local', label: 'digest regression' }).metadata.materialDigest).toBe(moduleMaterialDigest(files));
  expect(materialSummary(files).materialDigest).toBe(moduleMaterialDigest(files));
  expect(materialSummary([...files].reverse()).materialDigest).toBe(moduleMaterialDigest(files));
});
