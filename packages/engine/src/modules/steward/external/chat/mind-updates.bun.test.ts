import {expect,test} from 'bun:test';
import {readMindUpdates} from './mind-updates';
const source={epoch:'current-chat-epoch',scopeRevision:7};

test('original-conversation status is read-only and optional without a model or Notify',async()=>{
 const calls:unknown[]=[];
 const update={id:'goal',revision:2,status:'waiting',goal:'交付应用中心',waitReason:'需要补齐公开材料接口',nextStep:'任务负责人继续处理',artifactRefs:[],updatedAt:'2026-11-14T07:00:00Z'};
 const result=await readMindUpdates(async(target,args)=>{calls.push({target,args});return {json:JSON.stringify({items:[update]})};},'actual-mind','original-chat',source);
 expect(result).toEqual([update]);
 expect(calls).toEqual([{target:{moduleId:'actual-mind',tool:'updates'},args:{conversationId:'original-chat',...source}}]);
 expect(await readMindUpdates(async()=>{throw Error('must not call');},undefined,'original-chat',source)).toEqual([]);
});
test('malformed optional status never breaks the conversation',async()=>{
 for(const value of [null,{json:'invalid'},{json:'{"items":[{"goal":42}]}'}]){
  expect(await readMindUpdates(async()=>value,'mind','chat',source)).toEqual([]);
 }
});
