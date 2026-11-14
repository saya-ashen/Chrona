import { test,expect } from 'bun:test';
import { runDomChecks } from './dom-checks';
test('UI lifetime and operation regressions',async()=>{expect((await runDomChecks()).checks).toBe(11);});
