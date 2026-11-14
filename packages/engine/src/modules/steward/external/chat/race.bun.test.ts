import { test, expect } from 'bun:test';
import { runRaceChecks } from './race-checks';
test('client selection and conflict races', async () => { expect((await runRaceChecks()).checks).toBe(7); });
