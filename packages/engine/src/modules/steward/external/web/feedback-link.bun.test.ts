import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const start=source.indexOf('function feedbackHref('),end=source.indexOf('\nfunction activeNavigation',start);
const href=new Function('pageHref',`${source.slice(start,end)}; return feedbackHref;`)((page:{module:string;id:string})=>`/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`) as (mind:object,page:object|null,path:string)=>string;
test('feedback navigation carries exact displayed app version and pathname, without page content or query',()=>{
 const url=new URL(href({module:'mind',id:'main'},{moduleId:'chat-id',hash:'a'.repeat(40)},'/p/chat/main'),'http://localhost');
 expect(url.pathname).toBe('/p/mind/main');expect(url.searchParams.get('feedbackApp')).toBe('chat-id');expect(url.searchParams.get('feedbackVersion')).toBe('a'.repeat(40));expect(url.searchParams.get('feedbackPage')).toBe('/p/chat/main');
 const system=new URL(href({module:'mind',id:'main'},null,'/apps'),'http://localhost');expect([...system.searchParams.keys()]).toEqual(['feedbackPage']);
});
