import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CoreRecovery} from './core-recovery';import {CoreMindStore} from './core-store';import {CoreMindService} from './core-service';import type {CoreAccess} from './core-types';
const owner:CoreAccess={subject:'real-owner',role:'owner',scopes:[{}]},application:CoreAccess={subject:'chat',role:'application',scopes:[{}]};
test('restored generation blocks ingestion/action until exact owner review; repeated original authorization is idempotent and newer restore blocks again',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mind-recovery-'));const store=new CoreMindStore(dir),service=new CoreMindService(store);
 try{const marker=join(dir,'.chrona-restore.json');const recovery=new CoreRecovery(dir,store,service);expect(recovery.status().blocked).toBe(false);
 writeFileSync(marker,JSON.stringify({version:1,id:'restore-one',restoredAt:new Date().toISOString()}));recovery.guard();expect(store.read().settings.restoreBlocked).toBe(true);
 const input={restoreId:'restore-one',decision:'authorize-restored-memory' as const,expectedVisibilityRevision:store.read().visibilityRevision};
 expect(()=>recovery.review(input,application)).toThrow('Only the owner');expect(()=>recovery.review({...input,restoreId:'older'},owner)).toThrow('generation changed');
 expect(()=>recovery.review({...input,expectedVisibilityRevision:0},owner)).toThrow('Review current');expect(recovery.review(input,owner).blocked).toBe(false);
 expect(recovery.review(input,owner).blocked).toBe(false);expect(new CoreRecovery(dir,store,service).status().blocked).toBe(false);
 writeFileSync(marker,JSON.stringify({version:1,id:'restore-two',restoredAt:new Date().toISOString()}));expect(new CoreRecovery(dir,store,service).status().blocked).toBe(true);expect(store.read().settings.restoreBlocked).toBe(true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('corrupt restore metadata fails closed and cannot be authorized with a fabricated generation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mind-recovery-bad-'));const store=new CoreMindStore(dir),service=new CoreMindService(store);
 try{writeFileSync(join(dir,'.chrona-restore.json'),'not-json');const recovery=new CoreRecovery(dir,store,service);expect(recovery.status().blocked).toBe(true);expect(store.read().settings.restoreBlocked).toBe(true);expect(()=>recovery.review({restoreId:'invented',decision:'authorize-restored-memory',expectedVisibilityRevision:store.read().visibilityRevision},owner)).toThrow('generation changed');}
 finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
