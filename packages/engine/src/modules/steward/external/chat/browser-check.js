async page => {
 const result=[];
 const base=page.url().split('?')[0];
 const assert=(value,message)=>{if(!value)throw Error(message);};
 for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[1024,768],[390,844]])for(const scenario of ['empty','long','running','error','settings']){
  await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height});
  await page.goto(base+'?scenario='+scenario);await page.waitForFunction(()=>document.querySelector('textarea')?.disabled===false);
  if(scenario==='long')await page.locator('.chat-messages').evaluate(el=>el.scrollTop=el.scrollHeight/2);
  if(scenario==='running')await page.locator('.chat-messages').evaluate(el=>el.scrollTop=el.scrollHeight);
  if(scenario==='settings'){
   await page.locator('.chat-tools-button').click();
   await page.locator('.chat-tool-search').fill('author');
   assert(await page.locator('.chat-settings').evaluate(el=>el.scrollTop===0),'settings did not start at title');
   const cb=await page.locator('.chat-tools input[type=checkbox]').boundingBox();assert(cb.width===16&&cb.height===16,'checkbox inherited host full width');
   assert(await page.locator('.chat-settings h2').isVisible(),'settings heading not visible');
  }
  const scroll=await page.locator('.chat-messages').evaluate(el=>({height:el.clientHeight,total:el.scrollHeight}));
  assert(scroll.height>=350,`reading space too small ${width} ${scenario}`);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'horizontal overflow');
  const composer=await page.locator('.chat-compose').boundingBox();assert(composer.y+composer.height<=height+1,'composer below viewport');
  if(scenario==='empty')assert(await page.locator('.chat-badge').textContent()==='可开始对话' && !(await page.locator('.chat-send').isEnabled()),'first use status or blank send gate wrong');
  if(scenario==='running')assert(await page.locator('.chat-stop').isVisible(),'running stop not visible');
  if(scenario!=='running')assert(await page.locator('.chat-stop').isVisible()===false,'idle stop should not compete with send');
  const path=`screenshots/${width}-${theme}-${scenario}.png`;await page.screenshot({path});
  result.push({width,height,theme,scenario,readingHeight:scroll.height,screenshot:path});
 }
 return {hostCSS:'test-support/host-style.css fixture',provider:'isolated preview only',states:result};
}
