import {test,expect} from 'bun:test';
import {runRegistrationChecks} from './registration-checks';
test('actual activated handler registers the executable Chat workspace page',async()=>{
  expect(await runRegistrationChecks()).toEqual({page:'main',layout:'workspace'});
});
