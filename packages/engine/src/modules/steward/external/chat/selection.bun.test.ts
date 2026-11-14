import { test, expect } from 'bun:test';
import { runSelectionChecks } from './selection-checks';
test('default selections, kernel bound and deep-link lifecycle',async()=>{expect((await runSelectionChecks()).checks).toBe(9);});
