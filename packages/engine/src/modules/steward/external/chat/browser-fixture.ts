import { readFileSync, writeFileSync } from 'node:fs';
const javascript = readFileSync('dist/ui.js', 'utf8').replace(/export\s*\{\s*([^}]+)\s*\};?\s*$/m, 'window.mountChat=mount;');
if (!javascript.includes('window.mountChat')) throw Error('bundle export pattern changed');
const fake = `
const scenario=new URL(location.href).searchParams.get('scenario')||'empty';
const model='验收模型 / offline';
const transcript=[{kind:'text',at:'1',text:'已经整理了请求的内容。以下是本轮的实现检查与下一步。\\n\\n- 保留原始请求身份\\n- 核对执行状态和交付证据\\n- 在需要时展开工具详情'}, {kind:'result',at:'2',tool:'fixture.inspect',text:'隔离证据：非真实模型输出'}];
const c={id:'fixture',title:'新对话',draft:'',revision:0,updatedAt:'1',settings:{providerId:'pi',model:'',thinking:'',tools:[]},attachments:[],messages:[],operations:[],deliveries:[],active:null};
if(scenario==='long'||scenario==='running')for(let i=0;i<6;i++)c.messages.push({id:'u'+i,role:'user',text:'请检查当前工作进展，并说明还需要哪些证据。',attachments:[]},{id:'a'+i,role:'assistant',run:{transcript}});
if(scenario==='running')c.active={runId:'fixture-run',status:'running',observedStatus:'running',settings:c.settings,transcript:[{kind:'text',text:'正在逐项核对材料，当前任务仍在运行…'}],events:[],interactions:[]};
if(scenario==='error')c.operations=[{key:'rejected',kind:'send',status:'rejected',error:'提供方暂不可用。原始请求未受理，草稿已保留。',errors:[{code:'unavailable',message:'Provider unavailable'}]}];
const records={fixture:c};window.fixtureCalls=[];
const catalog={providers:[{id:'pi',name:'Pi（隔离提供方）',available:true}],configs:{pi:{models:[{value:'',label:'继承模型'},{value:'fixture/model',label:model}],thinking:['off','minimal','low','medium','high','xhigh','max'],warning:'选项来自隔离合同；不代表真实模型验收。'}},tools:[{module:'author',target:{moduleId:'author-fixture',tool:'submit'},description:'提交固定应用材料，返回真实候选回执。',available:true},{module:'notify',target:{moduleId:'notify-fixture',tool:'send'},description:'通过用户选择的渠道发送通知。',available:true}]};
async function call(name,args={}){window.fixtureCalls.push({name,args});let result;const row=records[args.id];switch(name){case 'catalog':result=catalog;break;case 'list':result={items:Object.values(records)};break;case 'create':result={...structuredClone(c),id:crypto.randomUUID(),messages:[],active:null,operations:[]};records[result.id]=result;break;case 'read':result=row;break;case 'draft':Object.assign(row,JSON.parse(args.patch));row.revision++;result=row;break;case 'edit':Object.assign(row,JSON.parse(args.patch));result=row;break;case 'delivery':result=row;break;default:throw Error('preview does not execute '+name);}return {json:JSON.stringify(result)};}
window.mountChat(document.querySelector('#chat-preview'),{call});
`;
const hostStyle = readFileSync('test-support/host-style.css','utf8');
writeFileSync('browser-fixture.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat · 宿主CSS隔离验收</title><style>${hostStyle}\n${readFileSync('ui.css','utf8')}</style><body class="web-shell-app web-shell-workspace"><header><strong>Chrona</strong><nav aria-label="主导航"><a href="#">今天</a><a href="#">对话</a><a href="#">应用</a><a href="#">活动</a><a href="#">设置</a></nav><button>退出</button></header><main id="main"><div id="chat-preview"></div></main><script type="module">${javascript}\n${fake}</script></body></html>`);
