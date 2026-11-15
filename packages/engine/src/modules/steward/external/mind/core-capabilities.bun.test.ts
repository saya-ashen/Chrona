import { moduleManifestSchema } from "@chrona/contracts/steward";
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { selectMindTools, type Capability } from './core-capabilities';

const authorTools = ['prepare', 'source', 'export', 'import', 'validate', 'read', 'write', 'list', 'stage', 'receipt', 'submit'];
const capabilities: Capability[] = authorTools.map(name => ({
  target: { moduleId: 'author-id', tool: name }, module: 'author', name,
  description: name, available: true,
}));

test('a pursuit can complete the advertised Author material workflow and read its persisted artifacts', () => {
  const selected = selectMindTools(capabilities, 'mind-id', 'pursuit');
  for (const tool of authorTools.filter(tool => tool !== 'submit')) {
    expect(selected).toContainEqual({ moduleId: 'author-id', tool });
  }
  expect(selected).toContainEqual({ moduleId: 'mind-id', tool: 'artifact' });
  expect(selected).toContain('modules.admit');
  expect(selected).not.toContainEqual({ moduleId: 'author-id', tool: 'submit' });
  const manifest = JSON.parse(readFileSync(new URL('./module.json', import.meta.url), 'utf8'));
  for (const tool of authorTools) expect(manifest.uses).toContain(`author.${tool}`);
});

test('understanding does not acquire development tools or select unavailable material operations', () => {
  expect(selectMindTools(capabilities, 'mind-id', 'understand').some(target =>
    typeof target !== 'string' && target.moduleId === 'author-id')).toBe(false);
  const selected = selectMindTools(capabilities.map(tool => ({ ...tool, available: tool.name !== 'import' })), 'mind-id', 'pursuit');
  expect(selected).not.toContainEqual({ moduleId: 'author-id', tool: 'import' });
});

test("complete Mind release manifest is accepted by the kernel", async () => {
 const manifest = await Bun.file(new URL("./module.json", import.meta.url)).json();
 expect(moduleManifestSchema.safeParse(manifest).success).toBe(true);
});

test("interface dependencies have no arbitrary count limit", async () => {
 const manifest = await Bun.file(new URL("./module.json", import.meta.url)).json();
 manifest.uses = Array.from({ length: 200 }, (_, i) => `application${i}.read`);
 expect(moduleManifestSchema.safeParse(manifest).success).toBe(true);
 manifest.uses.push("not a valid interface");
 expect(moduleManifestSchema.safeParse(manifest).success).toBe(false);
});
