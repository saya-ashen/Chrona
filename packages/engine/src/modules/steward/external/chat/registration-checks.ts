import { strict as assert } from 'node:assert';
import { createRegistrationTest } from './test-support/registration-test.mjs';
export async function runRegistrationChecks() {
  const h = await createRegistrationTest(import.meta.dirname + '/index.ts');
  try {
    await h.activate();
    // The portable JS bundle loses its generic read result during TS inference.
    const page: unknown = await h.pages.get('chat','main');
    assert.ok(page && typeof page === 'object' && 'layout' in page && 'spec' in page);
    assert.equal(page.layout,'workspace');
    const spec = page.spec;
    assert.ok(spec && typeof spec === 'object' && 'elements' in spec);
    const elements = spec.elements;
    assert.ok(elements && typeof elements === 'object' && 'chat' in elements);
    const chat = elements.chat;
    assert.ok(chat && typeof chat === 'object' && 'type' in chat);
    assert.equal(chat.type,'chat:Workbench');
    return { component:'chat:Workbench', layout:'workspace' };
  } finally { await h.close(); }
}
