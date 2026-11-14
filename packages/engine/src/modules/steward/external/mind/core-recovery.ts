import {existsSync,readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import type {CoreMindStore} from './core-store';
import type {CoreMindService} from './core-service';
import {CoreError,type CoreAccess} from './core-types';
const RUNTIME:CoreAccess={subject:'runtime:restore',role:'runtime',scopes:[{}]};
/** A supported host restore stamps a fresh generation in every restored app's private directory. */
export class CoreRecovery {
 private readonly marker:string;private readonly accepted:string;
 constructor(directory:string,private readonly store:CoreMindStore,private readonly service:CoreMindService){this.marker=join(directory,'.chrona-restore.json');this.accepted=join(directory,'.mind-restore-review.json');this.guard();}
 private read(path:string):Record<string,unknown>|undefined{
  if(!existsSync(path))return undefined;if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('Recovery marker must be a regular private file');
  const result=JSON.parse(readFileSync(path,'utf8')) as unknown;if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid recovery marker');return result as Record<string,unknown>;
 }
 status(){
  try{const marker=this.read(this.marker),accepted=this.read(this.accepted);if(!marker)return {blocked:this.store.inspect(tx=>tx.settings().restoreBlocked),restoreId:null,reason:this.store.inspect(tx=>tx.settings().restoreBlocked)?'Retraction ledger requires owner review':null};
   if(marker.version!==1||typeof marker.id!=='string'||!marker.id)throw Error('Invalid host restore generation');
   return {blocked:accepted?.id!==marker.id||this.store.inspect(tx=>tx.settings().restoreBlocked),restoreId:marker.id,restoredAt:marker.restoredAt,reason:accepted?.id!==marker.id?'Restored memory may predate later forget requests; owner review is required':null};
  }catch(error){return {blocked:true,restoreId:null,reason:error instanceof Error?error.message:'Recovery metadata unavailable'};}
 }
 guard(){const status=this.status();if(status.blocked&&!this.store.inspect(tx=>tx.settings().restoreBlocked))this.service.setRestoreBlocked(true,RUNTIME);return status;}
 review(input:{restoreId:string;expectedVisibilityRevision:number;decision:'authorize-restored-memory'},access:CoreAccess){
  if(access.role!=='owner')throw new CoreError('FORBIDDEN','Only the owner can authorize restored memory after review');
  const status=this.guard();if(!status.restoreId||status.restoreId!==input.restoreId||input.decision!=='authorize-restored-memory')throw new CoreError('CONFLICT','Restore generation changed or explicit review is missing');
  if(!status.blocked)return status;
  if(this.store.inspect(tx=>tx.meta().visibilityRevision)!==input.expectedVisibilityRevision)throw new CoreError('CONFLICT','Review current restored state before authorization');
  const next=this.accepted+'.next';writeFileSync(next,JSON.stringify({id:status.restoreId,reviewedAt:new Date().toISOString(),subject:access.subject}),{mode:0o600});renameSync(next,this.accepted);
  if(this.store.inspect(tx=>tx.settings().restoreBlocked))this.service.setRestoreBlocked(false,RUNTIME);
  return this.status();
 }
}
