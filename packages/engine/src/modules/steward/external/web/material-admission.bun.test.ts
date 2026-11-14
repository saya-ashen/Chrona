import {test, expect} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMaterialAdmission} from './material-admission';

async function fixture(run: (f: any) => Promise<void>) {
 const dir=await mkdtemp(join(tmpdir(),'web-material-test-'));
 const m={id:'apps:12345678-1234-1234-1234-123456789abc',name:'qq',state:'prepared',fingerprint:'f'.repeat(64),submitter:{moduleId:'apps-id',hash:'a'.repeat(40)},target:{name:'qq',moduleId:null,expectedActiveHash:null}};
 const modules:any[]=[{id:'apps-id',name:'apps',status:'active',activeHash:'a'.repeat(40)}];
 const calls:any[]=[];let lose=false;
 const call=async(t:string,a:any,o:any)=>{
  calls.push({t,a,o});if(t==='modules.list')return {items:modules};
  if(t!=='modules.admit')throw Error('Unexpected mutation '+t);
  if(lose){lose=false;throw Error('unknown response');}
  return {admissionId:'admission',requestKey:'original-submit-key',...a};
 };
 const create=()=>createMaterialAdmission(dir,call,async()=>({json:JSON.stringify({materials:[m]})}));
 const input={appsModuleId:'apps-id',materialId:m.id,fingerprint:m.fingerprint,confirmed:true};
 try{await run({m,modules,calls,create,input,lose:()=>{lose=true;}});}finally{await rm(dir,{recursive:true,force:true});}
}
test('exact prepared material: concurrent clicks and restart reuse persisted admission, no submit or approval',()=>fixture(async f=>{
 const handler=f.create();const [a,b]=await Promise.all([handler(f.input),handler(f.input)]);
 expect(a).toEqual(b);expect((await f.create()(f.input)).requestKey).toBe('original-submit-key');
 expect(f.calls.filter((c:any)=>c.t==='modules.admit')).toHaveLength(1);
 expect(f.calls.filter((c:any)=>c.t==='modules.admit')[0].a).toEqual({submitter:f.m.submitter,targets:[f.m.target]});
}));
test('lost admission reply reuses original invocation key after restart',()=>fixture(async f=>{
 f.lose();await expect(f.create()(f.input)).rejects.toThrow('unknown response');
 await f.create()(f.input);const grants=f.calls.filter((c:any)=>c.t==='modules.admit');
 expect(grants).toHaveLength(2);expect(grants[0].o.key).toBe(grants[1].o.key);
}));
test('rejects unconfirmed or invented owner/target, missing or changed material, submitter drift and new-install conflict',()=>fixture(async f=>{
 const h=f.create();
 for(const x of [{...f.input,confirmed:false},{...f.input,owner:true},{...f.input,submitter:f.m.submitter},{...f.input,fingerprint:'e'.repeat(64)}])await expect(h(x)).rejects.toThrow();
 f.m.state='unknown';await expect(h(f.input)).rejects.toThrow('不再待提交');f.m.state='prepared';
 f.modules[0].activeHash='c'.repeat(40);await expect(h(f.input)).rejects.toThrow('提交方');f.modules[0].activeHash='a'.repeat(40);
 f.modules.push({id:'existing',name:'qq',activeHash:'d'.repeat(40)});await expect(h(f.input)).rejects.toThrow('基线');
 expect(f.calls.filter((c:any)=>c.t==='modules.admit')).toHaveLength(0);
}));
test('managed update admits exact baseline, refuses drift or material mutation under original id',()=>fixture(async f=>{
 f.modules.push({id:'qq-id',name:'qq',activeHash:'b'.repeat(40)});f.m.target={name:'qq',moduleId:'qq-id',expectedActiveHash:'b'.repeat(40)};
 await f.create()(f.input);
 f.m.fingerprint='e'.repeat(64);await expect(f.create()({...f.input,fingerprint:f.m.fingerprint})).rejects.toThrow('原材料绑定');
 f.modules[1].activeHash='c'.repeat(40);await expect(f.create()({...f.input,fingerprint:f.m.fingerprint})).rejects.toThrow('基线');
}));
