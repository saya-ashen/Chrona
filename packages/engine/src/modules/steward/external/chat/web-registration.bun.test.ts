import {test,expect} from 'bun:test';
import {runRegistrationChecks} from './registration-checks';
test('actual activated handler registers exact Chat component and workspace page',async()=>{
  expect(await runRegistrationChecks()).toEqual({component:'chat:Workbench',layout:'workspace'});
});
