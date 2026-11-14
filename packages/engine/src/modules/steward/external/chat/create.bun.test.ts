import { test, expect } from 'bun:test';
import { runCreateChecks } from './create-checks';
test('durable create receipts, lost replies, remounts and kernel names',async()=>{expect((await runCreateChecks()).checks).toBe(6);});
