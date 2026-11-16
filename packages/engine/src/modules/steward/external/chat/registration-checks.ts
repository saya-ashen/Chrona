import { strict as assert } from 'node:assert';
import { createRegistrationTest } from './test-support/registration-test.mjs';
export async function runRegistrationChecks() {
  const h = await createRegistrationTest(import.meta.dirname + '/index.ts');
  try {
    await h.activate();
    // The portable JS bundle loses its generic read result during TS inference.
    const page: unknown = await h.pages.get('chat','main');
    assert.ok(page && typeof page === 'object' && 'layout' in page && 'javascript' in page);
    assert.equal(page.layout,'workspace');
    assert.equal(typeof page.javascript,'string');
    assert.ok('moduleId' in page && 'hash' in page && 'revision' in page);
    return { page:'main', layout:'workspace' };
  } finally { await h.close(); }
}
