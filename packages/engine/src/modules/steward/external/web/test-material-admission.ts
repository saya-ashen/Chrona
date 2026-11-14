import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMaterialAdmission} from './material-admission';
export async function checkMaterialAdmission(){
 const dir=await mkdtemp(join(tmpdir(),'web-owner-material-'));
 const m={id:'apps:12345678-1234-1234-1234-123456789abc',name:'qq',fingerprint:'f'.repeat(64),state:'prepared',submitter:{moduleId:'apps-id',hash:'a'.repeat(40)},target:{name:'qq',moduleId:null,expectedActiveHash:null}};
 const input={appsModuleId:'apps-id',materialId:m.id,fingerprint:m.fingerprint,confirmed:true};
 const calls:any[]=[];let lose=true;
 const call=async(t:string,a:any,o:any)=>{
  if(t==='modules.list')return {items:[{id:'apps-id',name:'apps',status:'active',activeHash:'a'.repeat(40)}]};
  assert.equal(t,'modules.admit','the owner endpoint never submits or approves');calls.push({a,o});
  if(lose){lose=false;throw Error('unknown');}
  return {admissionId:'exact',requestKey:'original-key',...a};
 };
 const create=()=>createMaterialAdmission(dir,call,async()=>({json:JSON.stringify({materials:[m]})}));
 try{
  await assert.rejects(create()({...input,owner:true}));assert.equal(calls.length,0);
  await assert.rejects(create()(input),/unknown/);
  const result=await create()(input);assert.equal(result.requestKey,'original-key');assert.equal(calls[0].o.key,calls[1].o.key);
  await create()(input);assert.equal(calls.length,2);
  m.state='unknown';await assert.rejects(create()(input),/不再待提交/);
 }finally{await rm(dir,{recursive:true,force:true});}
}
