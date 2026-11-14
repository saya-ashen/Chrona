import { test, expect } from 'bun:test';
import { runStateChecks } from './state-checks';
test('Agent contract and confirmed recovery regressions', async () => { expect(await runStateChecks()).toBe(15); });
