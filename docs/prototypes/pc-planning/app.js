/* Local-only design reference. All products, prices, shops and conversations are fixtures.
 * No production APIs, storage, external links, provider calls or background monitoring. */
'use strict';
const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  computer: '<rect x="2" y="4" width="16" height="12" rx="2"/><path d="M7 20h6M10 16v4M21 7v13"/>',
  plane: '<path d="m3 11 18-8-8 18-2-8-8-2zM11 13l5-5"/>',
  book: '<path d="M12 5c-4-3-9-1-9-1v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1v15"/>',
  page: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chat: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/><path d="M8 8h8M8 12h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  gpu: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M16 9v6M6 18v3M10 18v3"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M6 10v4M10 10v4M14 10v4M18 10v4M6 17v3M10 17v3M14 17v3M18 17v3"/>',
  drive: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="11" r="4"/><path d="m12 11 4 5M8 19h1"/>',
  leaf: '<path d="M20 3C9 2 3 7 5 14c3 7 14 5 15-11zM4 21 16 8"/>',
  folder: '<path d="M3 6h6l2 3h10v11H3z"/>'
};
const icon = name => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${paths[name] || paths.page}</svg></span>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const currency = value => `¥${value.toLocaleString('en-US')}`;
const parts = [
  { id:'cpu', label:'CPU', model:'AMD Ryzen 7 9700X', why:'游戏之外，也兼顾多任务', icon:'chip', price:2000, easy:2100, shop:'淘宝 · 示例店 A', spec:'处理器示例；散片／盒装差异需核对', caution:'示例报价假设可用店铺券。真实渠道、版本与保修主体需另行核实。' },
  { id:'gpu', label:'显卡', model:'GeForce RTX 5070', why:'把预算优先留给游戏体验', icon:'gpu', price:4200, easy:4300, shop:'京东 · 示例店 B', spec:'品牌、完整型号和显存规格需确认', caution:'页面起价不等于指定型号到手价。真实商品链接、库存与退换条件尚未核查。' },
  { id:'ram', label:'内存', model:'32GB DDR5 · 16GB × 2', why:'暂时不为用不到的容量加钱', icon:'memory', price:550, easy:580, shop:'京东 · 示例店 B', spec:'双通道套装，频率与兼容清单待核', caution:'示例总价按一套两根计算，不是单根价格。平台与频率兼容性未实测。' },
  { id:'ssd', label:'硬盘', model:'2TB NVMe SSD', why:'给常玩的游戏留足空间', icon:'drive', price:700, easy:760, shop:'京东 · 示例店 B', spec:'具体控制器、颗粒及保修条款待核', caution:'保修年限与写入量限制不能只依据商品标题判断。这里只展示信息结构。' },
  { id:'board', label:'主板', model:'B650M · 带 Wi-Fi', why:'先满足接口与无线连接需求', icon:'chip', price:900, easy:950, shop:'淘宝 · 示例店 A', spec:'处理器支持列表、BIOS 与接口待核', caution:'需要核对具体板型、BIOS、CPU 支持列表，不因芯片组名称就保证能点亮。' },
  { id:'cooler', label:'散热', model:'双塔风冷散热器', why:'不为外观额外上水冷', icon:'leaf', price:160, easy:180, shop:'京东 · 示例店 B', spec:'安装扣具、内存避让与高度待核', caution:'具体散热器高度与内存、机箱间隙没有实际校验；示例不可直接采购。' },
  { id:'power', label:'电源', model:'750W · 金牌', why:'电源不只比较额定瓦数', icon:'page', price:450, easy:490, shop:'京东 · 示例店 B', spec:'具体型号、接口、保护与保修待核', caution:'金牌只涉及效率，并不独立证明产品品质；真实选型还要核对可靠性、接口和负载。' },
  { id:'case', label:'机箱', model:'简洁网孔机箱', why:'不要灯效，优先通风', icon:'computer', price:300, easy:320, shop:'京东 · 示例店 B', spec:'显卡长度、散热高度与风扇数量待核', caution:'显卡、主板和散热空间均需要用具体型号核验。这里没有进行兼容性验证。' }
];
const totals = { saving:parts.reduce((sum,p)=>sum+p.price,0), easy:parts.reduce((sum,p)=>sum+p.easy,0) };
const fixtures = [
  { id:'weekend', title:'周末去哪里', icon:'plane', body:'想找个不用赶路的地方，和朋友待半天。\n\n先看看天气，再决定去河边散步还是找一家安静的咖啡馆。\n\n待商量：周六还是周日？\n\n这是用来体验切换页面的虚构笔记。' },
  { id:'reading', title:'读书清单', icon:'book', body:'接下来想读的书\n\n• 一本关于日常观察的随笔\n• 一本朋友推荐的小说\n\n不急着排计划，读到有意思的地方再记下来。\n\n这是用来体验直接书写的虚构笔记。' }
];
const fresh = () => ({ expanded:false, route:'saving', noteDraft:'', noteChoice:'undecided', decision:'undecided', notes:[], events:[], editing:null, pages:fixtures.map(p=>({...p})), savedPages:{}, scroll:{} });
let state = fresh();
let activeRoute = location.hash.slice(1) || 'computer';
let trigger = null;
let toastTimer;
const content = document.querySelector('#content');
const modal = document.querySelector('#modal');
const modalBody = document.querySelector('#modal-body');
const action = (label,name,style='',extra='') => `<button type="button" class="button ${style}" data-action="${name}" ${extra}>${label}</button>`;
const textAction = (label,name,extra='') => `<button type="button" class="text-button" data-action="${name}" ${extra}>${label}</button>`;
const link = (label,href,style='') => `<a class="button ${style}" href="#${href}">${label}</a>`;
const decisionLabels = { undecided:'正在和家人商量购买时间，先保留这套方案。', soon:'决定近期购买，下单前再核对一次价格和型号。', later:'决定再等等，暂时保留这套方案和购买参考。' };
const choiceLabels = { undecided:'还没决定', soon:'准备近期购买', later:'准备稍后购买' };
const lastNote = () => state.notes[state.notes.length-1];
const pcArt = `<svg class="computer-art" viewBox="0 0 154 120" aria-hidden="true"><ellipse cx="80" cy="108" rx="67" ry="7" fill="#f4f3ed"/><g class="outline"><rect x="13" y="18" width="90" height="63" rx="5" class="soft"/><rect x="19" y="24" width="78" height="49" rx="2" class="screen"/><path d="M52 81v15h13V81M42 97h33" fill="none"/><path d="m24 64 22-20 17 9 17-21 12 9" stroke="#afbd99" fill="none"/><path d="m26 68 20-14 16 7 22-21 8 9" stroke="#c2cbaa" fill="none"/><rect x="112" y="41" width="30" height="61" rx="4" fill="#f7f5ef"/><circle cx="127" cy="56" r="7" fill="#eceee4"/><circle cx="127" cy="76" r="7" fill="#eceee4"/><circle cx="133" cy="94" r="1" fill="#90a278"/><path d="m21 104 9-5h50l10 5z" fill="#edece4"/></g></svg>`;
function pagesNav(close=false) {
  const suffix = close ? ' data-close' : '';
  return `<nav class="sidebar-nav" aria-label="主要页面"><a class="side-link" href="#home"${activeRoute==='home'?' aria-current="page"':''}${suffix}>${icon('home')}<span>首页</span></a><button type="button" class="side-button create" data-action="new">${icon('plus')}<span>新建一页</span></button></nav><p class="side-heading">最近打开</p><nav class="sidebar-nav" aria-label="最近页面"><a class="side-link" href="#computer"${activeRoute.startsWith('computer')?' aria-current="page"':''}${suffix}>${icon('computer')}<span>配一台新电脑</span></a>${state.pages.map(p=>`<a class="side-link" href="#page/${p.id}"${activeRoute===`page/${p.id}`?' aria-current="page"':''}${suffix}>${icon(p.icon)}<span>${esc(p.title || '无标题')}</span></a>`).join('')}<a class="side-link" href="#all"${suffix}><span class="icon">···</span><span>查看全部</span></a></nav>`;
}
function renderSidebar() {
  document.querySelector('#sidebar').innerHTML=`<a class="brand" href="#home"><span class="brand-mark" aria-hidden="true">c</span>chrona</a><button type="button" class="side-button" data-action="search">${icon('search')}<span>搜索页面</span></button>${pagesNav()}<div class="side-foot"><span class="avatar">S</span><span>我的空间</span></div>`;
}
function routeTitle() {
  if(activeRoute==='home') return '首页';
  if(activeRoute==='all') return '所有页面';
  if(activeRoute.startsWith('page/')) return state.pages.find(p=>p.id===activeRoute.split('/')[1])?.title || '无标题';
  return ({computer:'配一台新电脑','computer/buy':'购买清单','computer/family':'给家人看的简版','computer/history':'之前的讨论与记录'})[activeRoute] || '页面';
}
function renderTopbar() {
  document.querySelector('#topbar').innerHTML=`<button type="button" class="icon-button mobile-nav" data-action="navigation" aria-label="打开页面导航">${icon('menu')}</button><div class="breadcrumb"><a href="#home">我的空间</a><span class="crumb-sep">/</span>${activeRoute.startsWith('computer/')?'<a href="#computer">配一台新电脑</a><span class="crumb-sep">/</span>':''}<span>${esc(routeTitle())}</span></div><button type="button" class="icon-button" data-action="more" aria-label="更多页面选项">${icon('more')}</button>`;
}
function componentRow(part) {
  return `<div class="component-row"><dt>${part.label}</dt><dd><span class="model">${part.model}</span><span class="why">${part.why}</span></dd><dd class="part-icon">${icon(part.icon)}</dd></div>`;
}
function mainPage() {
  const note=lastNote();
  return `<article class="page"><header class="intro"><div class="intro-copy"><h1>配一台新电脑</h1><p>2K 游戏和日常办公 · 主机预算 1 万元以内<br>不含显示器和外设，不为灯效额外花钱。</p></div>${pcArt}</header><p class="byline">${icon('page')}根据与 Agent 的讨论整理 · 示例方案</p><div class="situation">${icon('chat')}<div><p>${decisionLabels[state.decision]}</p>${state.decision!=='undecided'?'<small>只是记下购买意向，没有下单、预约或启动比价。</small>':''}</div>${textAction('记下结果','focus-note')}</div><section aria-labelledby="config-title"><div class="section-title"><h2 id="config-title">先按这套配</h2><p>性能优先，不堆多余配置</p></div><dl class="config-list">${parts.slice(0,4).map(componentRow).join('')}</dl><div id="extra-components" class="extra-components"${state.expanded?'':' hidden'}><dl class="config-list">${parts.slice(4).map(componentRow).join('')}</dl><p class="footnote">这里展示方案应有的内容层次，尚未用完整产品型号验证兼容性，不能直接照此采购。</p></div><div class="config-foot">${textAction(state.expanded?'收起完整配置 ↑':'完整配置 · 8 项 ↓','expand-config',`aria-expanded="${state.expanded}" aria-controls="extra-components"`)}<p>主板、电源、散热和机箱也已列入清单</p></div><details><summary>为什么这样配？</summary><div class="explanation"><p>主要预算放在显卡，兼顾日常多任务。先选 32GB 内存和 2TB 存储；没有明确需求，就不加到 64GB，也不为了外观选水冷。</p><p>先保留这套讨论方案。后续如果只是价格变化，不必从头选一遍；需要换型号时，再比较差异。</p><p>这是虚构的讨论结论，不是性能测试或真实硬件兼容性保证。</p></div></details></section><section class="purchase-preview" aria-labelledby="purchase-title"><div class="section-title"><h2 id="purchase-title">怎么买比较合适</h2><p>示例报价 · 9 月 17 日</p></div><div class="purchase-strip"><div class="purchase-price"><small>已比较的示例报价中，分开买更省钱</small><div class="price"><small>约</small>${currency(totals.saving)}</div><p>淘宝＋京东，分两家买齐这 8 件</p></div>${link(`打开购买清单 ${icon('arrow')}`,'computer/buy','primary')}</div><p class="route-alternative">想少拆单？集中购买约 ${currency(totals.easy)}。 <a class="text-button" href="#computer/buy" data-easy>看看区别</a></p><div class="subtle-note">${icon('clock')}<span>价格和优惠会变。下单前要重新核对，不会自动监控或锁价。</span></div></section><section class="notes-section" aria-labelledby="notes-title"><div class="section-title"><h2 id="notes-title">想法和商量结果</h2>${link('给家人看的简版','computer/family','quiet small')}</div><p class="section-sub">${state.decision==='undecided'?'现在买，还是过几天再买？不急着在这里做决定。':'新的想法记在这里，方案和购买清单先保持不变。'}</p>${note?`<article class="saved-note"><small>你 · 刚刚记下${state.editing===note.id?' · 正在修改':''}</small><p>${esc(note.text)}</p>${textAction('修改这条笔记','edit-note')}</article>`:''}<form id="note-form"><div class="note-box"><label class="sr-only" for="note">记下商量结果或新的想法</label><textarea id="note" maxlength="3000" placeholder="记下商量结果，或者新的想法…">${esc(state.noteDraft)}</textarea><div class="note-tools"><label>购买时间 <select id="buy-timing" aria-label="购买时间">${Object.entries(choiceLabels).map(([value,label])=>`<option value="${value}"${value===state.noteChoice?' selected':''}>${label}</option>`).join('')}</select></label><button class="button primary" type="submit">${state.editing?'保存修改':'记下来'}</button></div></div><p id="note-error" class="form-error" role="alert"></p><p class="note-meta">只记在这页，不会发给 Agent 或代你下单。预览内容刷新后重置。</p></form>${state.decision!=='undecided'?`<div class="actions spaced">${textAction('下次找 Agent 继续时，需要告诉它什么？','handoff')}</div>`:''}</section><a class="history-link" href="#computer/history">${icon('clock')} 查看之前比较过的方案与记录 ${icon('arrow')}</a><footer class="page-bottom">这是一份会随着讨论更新的方案，不是一份聊天流水账。</footer></article>`;
}
function buyingPage() {
  const easy=state.route==='easy';
  const groups=new Map();
  parts.forEach(p=>{const shop=easy?'京东 · 示例店 B':p.shop;if(!groups.has(shop))groups.set(shop,[]);groups.get(shop).push(p);});
  return `<article class="page"><a class="back" href="#computer">${icon('back')}回到装机方案</a><h1>购买清单</h1><p class="page-lead">还是同一套配置，只比较在哪里买。等决定购买时，再核对一次价格、优惠资格和具体型号。</p><div class="route-options" aria-label="比较购买方式">${['saving','easy'].map(route=>`<button type="button" class="route-option" data-route="${route}" aria-pressed="${state.route===route}"><span class="route-top"><strong>${route==='saving'?'更省钱 · 分开买':'更省事 · 少拆单'}</strong><span class="route-check" aria-hidden="true">✓</span></span><div class="price">${currency(totals[route])}</div><small>${route==='saving'?'淘宝＋京东 · 两家示例店铺':`集中到一家示例店铺 · 多 ${currency(totals.easy-totals.saving)}`}</small></button>`).join('')}</div><p class="purchase-caveat">这些金额只是 9 月 17 日这一轮的虚构报价样本，不是实时价格。切换买法只是查看区别，不会替你作购买决定。</p>${[...groups].map(([shop,items])=>`<section aria-label="${shop}"><div class="shop-heading"><div><h2>${shop}</h2><small>${easy?'集中采购，售后规则仍要逐件确认':shop.startsWith('淘宝')?'CPU 和主板放在一起比较':'其余配件集中比较'}</small></div><span class="shop-total">${items.length} 件 · ${currency(items.reduce((sum,p)=>sum+(easy?p.easy:p.price),0))}</span></div>${items.map(p=>`<div class="buy-row"><div><strong>${p.label} · ${p.model}</strong><small>${p.spec}</small></div><div class="buy-price">${currency(easy?p.easy:p.price)}</div>${textAction('商品信息（示例） ↗','product',`data-part="${p.id}"`)}</div>`).join('')}</section>`).join('')}<div class="purchase-summary"><span>8 件合计 · 示例按含运费估算</span><span class="price">${currency(totals[state.route])}</span></div><details><summary>优惠、售后和比价依据 ↓</summary><div class="explanation"><p>两条路线按同一组配置比较；本原型没有真实 SKU、店铺身份、库存或商品链接。单项优惠能否叠加、是否需要会员，都没有实际核验。</p><p>真实页面应在这里保留对应商品、规格、报价时间、优惠条件和售后来源；最低展示价不能直接作为可购买到手价。</p><p>“更省钱”只比较本页样例，不意味着全网最低价。没有模拟已购标记，也不会自动创建订单。</p></div></details><p class="footnote">还没决定什么时候买？先保留这份清单即可，不需要逐件点确认。</p><div class="actions spaced">${link('回到方案','computer')} ${action('获取重新核价要点','handoff','quiet')}</div></article>`;
}
function familyPage() {
  return `<article class="page narrow"><a class="back" href="#computer">${icon('back')}回到装机方案</a><p class="eyebrow">给家人看的简版 · 示例内容</p><h1>这次想配一台怎样的电脑</h1><p class="page-lead">不用先认识每个零件，也能一起讨论需求、预算和购买时间。</p><section class="family-summary"><h2>主要用来做什么</h2><p>主要是 2K 游戏和日常办公，希望有足够的性能，也不要为了灯效和外观多花钱。这里没有假定旧电脑已经坏了，是否需要现在更换仍然可以商量。</p></section><section class="family-summary"><h2>大概要花多少钱</h2><div class="family-cost"><span class="price">${currency(totals.saving)}</span><p>这轮示例清单合计<br>不含显示器、外设和其他未列费用</p></div><p>讨论中的主机预算是 1 万元以内。分开买更省钱；如果想少拆单，示例集中购买方案约 ${currency(totals.easy)}。</p></section><section class="family-summary"><h2>为什么不再加配置</h2><p>先满足主要用途。内存、硬盘、电源和散热也留了预算，没有为了暂时用不到的功能继续向上加钱。</p><p>具体型号仍需在购买前核对，不把本页的示例配置当作已验证的兼容方案。</p></section><section class="family-summary"><h2>现在买，还是再等等</h2><p>${decisionLabels[state.decision]}</p><p>目前没有可靠依据断言“过几天一定更便宜”。可以等商量好，再重新查一遍这套配置的价格；不用重新开始整个选型。</p>${lastNote()?`<div class="saved-note"><small>我记下的商量结果</small><p>${esc(lastNote().text)}</p></div>`:''}</section><div class="actions spaced">${action('选取简版文字','family-copy','primary')} ${link('回到方案记下想法','computer','quiet')}</div><p class="footnote">没有自动分享。只有你手动复制并发送后，家人才会看到这些内容。</p></article>`;
}
function historyPage() {
  const rows=[...state.events].reverse().concat([
    {time:'9 月 17 日 · Agent 整理（样例）',title:'把在哪里买也整理清楚了',text:`比较了两条购买路线：分开买约 ${currency(totals.saving)}，集中购买约 ${currency(totals.easy)}。保留优惠与售后核查项，还没有购买决定。`},
    {time:'9 月 17 日 · 讨论结论（样例）',title:'先保留这套配置',text:'把预算放在游戏体验，内存先用 32GB，存储先用 2TB。更高配置暂不考虑；没有完整型号兼容性实查，购买前仍需核验。'},
    {time:'9 月 16 日 · 需求约定（样例）',title:'主机预算 1 万元以内',text:'主要用于 2K 游戏与日常办公，不含显示器，不追求灯效。不直接购买，先与家人商量。'}
  ]);
  return `<article class="page narrow"><a class="back" href="#computer">${icon('back')}回到装机方案</a><h1>之前的讨论与记录</h1><p class="page-lead">保留重要结论、理由和你的决定，不搬进整段聊天。</p><section class="history-section">${rows.map(row=>`<article class="history-entry"><small>${esc(row.time)}</small><h2>${esc(row.title)}</h2><p>${esc(row.text)}</p></article>`).join('')}</section><p class="footnote">这是设计样例，不是实际发生过的对话。用户笔记与 Agent 整理内容分开保存，笔记不会自动改写配置。</p></article>`;
}
function homePage() {
  return `<article class="page home-page"><p class="home-date">9 月 17 日，星期四 · 示例的一天</p><h1>最近怎么样</h1><p class="page-lead">正在考虑的事，都还在这里。</p><section class="home-group" aria-label="最近的事情"><a class="home-item" href="#computer">${icon('computer')}<div><h2>配一台新电脑</h2><p>${decisionLabels[state.decision]}</p><small>方案和购买参考已整理 · 示例合计 ${currency(totals.saving)}</small></div><span class="home-arrow">↗</span></a>${state.pages.slice(0,4).map(p=>`<a class="home-item" href="#page/${p.id}">${icon(p.icon)}<div><h2>${esc(p.title||'无标题')}</h2><p>${esc(p.body.split('\n').find(s=>s.trim())||'打开，接着写点什么。')}</p><small>你的笔记${p.id.startsWith('local-')?' · 这次预览中创建':' · 虚构样例'}</small></div><span class="home-arrow">↗</span></a>`).join('')}</section><form id="quick-form" class="home-write"><label for="quick-note">想记点什么？</label><div class="home-input"><input id="quick-note" placeholder="写下一个想法或要做的事…" maxlength="120" required><button class="button quiet" type="submit" aria-label="记下并打开新页面">${icon('arrow')}</button></div><p class="note-meta">先记下来，不会自动启动 Agent。</p></form></article>`;
}
function editorPage(id) {
  const page=state.pages.find(p=>p.id===id);
  if(!page)return `<article class="page"><h1>这一页已随预览重置</h1><p class="page-lead">临时页面不会保存在真实账户里。</p>${link('回首页','home')}</article>`;
  return `<article class="page narrow"><p class="blank-hint">直接写就好，不必先选择任务类型。</p><label class="sr-only" for="page-title">页面标题</label><input id="page-title" class="editor-title" maxlength="120" placeholder="无标题" value="${esc(page.title)}" data-id="${page.id}"><h1 class="sr-only">${esc(page.title||'无标题')}</h1><label class="sr-only" for="page-body">页面内容</label><textarea id="page-body" class="editor-body" maxlength="12000" placeholder="在这里写下想法、要做的事，或者下一次继续需要的背景…" data-id="${page.id}">${esc(page.body)}</textarea><div class="actions">${action('记下来','save-page','primary')}<span id="editor-status" class="note-meta">${state.savedPages[id]?'已记在这次预览中':'内容只在这次预览中保留，刷新后重置。'}</span></div><p class="footnote">没有创建真实任务或启动 Agent。这一页用来体验“打开就知道在哪里写”。</p></article>`;
}
function directoryPage() {
  return `<article class="page narrow"><h1>所有页面</h1><p class="page-lead">不用区分它是任务、事项还是笔记。先找到那件事。</p><nav class="directory" aria-label="所有页面"><a href="#computer">${icon('computer')}配一台新电脑</a>${state.pages.map(p=>`<a href="#page/${p.id}">${icon(p.icon)}${esc(p.title||'无标题')}</a>`).join('')}</nav><div class="actions spaced">${action(`${icon('plus')}新建一页`,'new')}</div></article>`;
}
function render() {
  renderSidebar();renderTopbar();
  content.innerHTML=activeRoute==='home'?homePage():activeRoute==='all'?directoryPage():activeRoute==='computer/buy'?buyingPage():activeRoute==='computer/family'?familyPage():activeRoute==='computer/history'?historyPage():activeRoute.startsWith('page/')?editorPage(activeRoute.split('/')[1]):mainPage();
  document.title=`${routeTitle()} · Chrona 参考页面`;
}
function notify(text) {
  const toast=document.querySelector('#toast');clearTimeout(toastTimer);toast.textContent=text;toast.hidden=false;toastTimer=setTimeout(()=>toast.hidden=true,5000);
}
function openModal(title,body) {
  if(!modal.open)trigger=document.activeElement;
  modalBody.innerHTML=`<header class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" type="button" data-action="close" aria-label="关闭">${icon('close')}</button></header>${body}`;
  if(!modal.open)modal.showModal();
}
function closeModal(){modal.close();}
modal.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus();else content.focus();});
function searchResults(query='') {
  const choices=[{id:'computer',title:'配一台新电脑',icon:'computer'},...state.pages.map(p=>({...p,id:`page/${p.id}`}))].filter(p=>(p.title||'无标题').includes(query));
  return choices.length?choices.map(p=>`<a href="#${p.id}" data-close>${icon(p.icon)}${esc(p.title||'无标题')}</a>`).join(''):'<p class="empty">没有找到这个页面。试试其他关键词。</p>';
}
function createPage(title='') {
  const id=`local-${state.pages.filter(p=>p.id.startsWith('local-')).length+1}`;
  state.pages.unshift({id,title,body:'',icon:'page'});closeModal();location.hash=`page/${id}`;
}
function copyView(title,text) {
  openModal(title,`<p class="modal-description">你可以选中文字后手动复制。没有自动发送、公开分享或启动 Agent。</p><label class="copy-label" for="copy-text">虚构示例，请勿作为真实购买依据</label><textarea id="copy-text" class="copy-text" readonly>${esc(text)}</textarea><div class="actions spaced">${action('选中文字，手动复制','select-copy','primary')}${action('关闭','close','quiet')}</div>`);
}
function handoff() {
  copyView('下次接着聊，不用从头开始',`【Chrona 参考原型 · 虚构内容，不是执行指令】\n\n事情：配一台新电脑。\n需求：2K 游戏与日常办公；主机预算 1 万元以内，不含外设，不追求灯效。\n当前讨论配置：${parts.map(p=>`${p.label} ${p.model}`).join('；')}。\n购买意向：${choiceLabels[state.decision]}。\n${lastNote()?`我记下的想法：${lastNote().text}\n`:''}上次示例比价：2026-09-17，分开买 ${currency(totals.saving)}，集中买 ${currency(totals.easy)}。不是实时价格。\n\n如果继续：先确认我实际希望做什么；保留当前需求和讨论方案，重新核对指定型号、完整兼容性、库存、优惠资格、运费与售后。需要换配置时解释差异，不直接替我决定。\n\n没有下单、付费、通知家人或后台监控授权；本文只是手动交接资料。`);
}
const actions={
  close:closeModal,
  search:()=>{openModal('找一个页面',`<label class="sr-only" for="search-input">搜索页面标题</label><input id="search-input" class="search-input" type="search" placeholder="输入页面名称…" autofocus><nav class="search-results" id="search-results" aria-label="搜索结果">${searchResults()}</nav>`);document.querySelector('#search-input').focus();},
  navigation:()=>openModal('我的页面',`<div>${pagesNav(true)}</div><div class="actions spaced">${action(`${icon('search')}搜索页面`,'search','quiet')}</div>`),
  new:()=>createPage(),
  more:()=>openModal('页面选项',`<div class="modal-links">${activeRoute.startsWith('computer')?`<a class="modal-link" href="#computer/family" data-close>${icon('page')}给家人看的简版</a><a class="modal-link" href="#computer/history" data-close>${icon('clock')}之前的讨论与记录</a><button class="modal-link" type="button" data-action="handoff">${icon('chat')}下次和 Agent 继续</button>`:''}<button class="modal-link" type="button" data-action="about">${icon('leaf')}关于这份参考页面</button></div>`),
  about:()=>openModal('先看内容，再考虑工具',`<p class="modal-description">这是第二轮参考页面：不再让你从“工作、任务、待处理”里选入口，直接打开配电脑这件事，读方案、看怎么买、写下想法。</p><div class="mock-note">所有配置、店铺、金额、历史和人物情境均为样例。没有真实比价、兼容性验证、账户读取、订单、通知或监控。</div><p class="modal-description">操作只改变这次预览的页面内存；刷新会重置。可以展开配置、切换买法、记下购买意向、看简版、切换页面或新建笔记。</p><div class="actions">${action('重置这次预览','reset','quiet')}${action('继续看看','close','primary')}</div>`),
  reset:()=>{state=fresh();closeModal();if(activeRoute==='computer'){render();window.scrollTo(0,0);}else location.hash='computer';notify('示例已重置，没有影响任何真实数据。');},
  'expand-config':()=>{state.expanded=!state.expanded;document.querySelector('#extra-components').hidden=!state.expanded;const b=document.querySelector('[data-action="expand-config"]');b.innerText=state.expanded?'收起完整配置 ↑':'完整配置 · 8 项 ↓';b.setAttribute('aria-expanded',String(state.expanded));},
  'focus-note':()=>{const box=document.querySelector('#note');box.focus({preventScroll:true});box.scrollIntoView({behavior:'auto',block:'center'});},
  'edit-note':()=>{const note=lastNote();if(!note)return;state.editing=note.id;state.noteDraft=note.text;state.noteChoice=state.decision;render();actions['focus-note']();},
  'save-page':()=>{const id=activeRoute.split('/')[1];state.savedPages[id]=true;document.querySelector('#editor-status').textContent='已记在这次预览中 · 刷新后重置';notify('已记在预览里，没有创建真实任务。');},
  product:target=>{const part=parts.find(p=>p.id===target.dataset.part);if(!part)return;const easy=state.route==='easy';openModal(`${part.label} · 商品信息示例`,`<p class="modal-description">${part.model}</p><dl class="modal-data"><div><dt>示例渠道</dt><dd>${easy?'京东 · 示例店 B':part.shop}</dd></div><div><dt>示例报价</dt><dd>${currency(easy?part.easy:part.price)} · 2026-09-17</dd></div><div><dt>规格</dt><dd>${part.spec}</dd></div><div><dt>购买前核查</dt><dd>${part.caution}</dd></div></dl><div class="mock-note">这里没有真实商品链接。正式使用时才会显示已核对的链接和条件；原型不会跳转电商或产生订单。</div>${action('回到清单','close','primary')}`);},
  handoff,
  'family-copy':()=>copyView('给家人看的简版',`【虚构页面示例，不是真实配置建议或报价】\n\n想配一台主机，主要用于 2K 游戏与日常办公。不为灯效多花钱，预算 1 万元以内，不含显示器和外设。\n\n目前样例配置含处理器、显卡、32GB 内存、2TB 存储、主板、散热、电源和机箱。分开购买的示例总额 ${currency(totals.saving)}；少拆单 ${currency(totals.easy)}。具体型号、兼容性、价格和优惠需要购买前重查。\n\n${decisionLabels[state.decision]}\n${lastNote()?`商量笔记：${lastNote().text}\n`:''}现在没有下单，也没有可靠依据说过几天一定降价。`),
  'select-copy':()=>{const text=document.querySelector('#copy-text');text.focus();text.select();notify('已选中，可用系统快捷键复制。没有发送给任何人。');}
};
document.addEventListener('click',event=>{
  if(event.target.closest('a.skip')){event.preventDefault();content.focus();return;}
  const target=event.target.closest('[data-action]');
  if(target&&!target.disabled){actions[target.dataset.action]?.(target);return;}
  const route=event.target.closest('[data-route]');
  if(route){state.route=route.dataset.route;render();document.querySelector(`[data-route="${state.route}"]`).focus();return;}
  if(event.target.closest('[data-easy]'))state.route='easy';
  if(event.target.closest('[data-close]'))closeModal();
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='note')state.noteDraft=el.value;
  if(el.id==='search-input')document.querySelector('#search-results').innerHTML=searchResults(el.value);
  if(el.id==='page-title'||el.id==='page-body'){
    const page=state.pages.find(p=>p.id===el.dataset.id);if(!page)return;
    page[el.id==='page-title'?'title':'body']=el.value;state.savedPages[page.id]=false;
    document.querySelector('#editor-status').textContent='编辑中 · 仅保留在这次预览里';
    if(el.id==='page-title'){renderSidebar();renderTopbar();document.querySelector('main h1').textContent=el.value||'无标题';document.title=`${el.value||'无标题'} · Chrona 参考页面`;}
  }
});
document.addEventListener('change',event=>{if(event.target.id==='buy-timing')state.noteChoice=event.target.value;});
document.addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.id==='note-form'){
    const text=state.noteDraft.trim();
    if(!text&&state.noteChoice===state.decision){document.querySelector('#note-error').textContent='先写点想法，或选择这次商量好的购买时间。';return;}
    const finalText=text||`购买时间：${choiceLabels[state.noteChoice]}。`;
    const note={id:state.editing||`note-${state.notes.length+1}`,text:finalText};
    if(state.editing){const i=state.notes.findIndex(n=>n.id===state.editing);state.notes[i]=note;}else state.notes.push(note);
    state.events.push({time:'刚刚 · 你（仅预览）',title:state.editing?'修改自己的笔记':'记下想法与购买意向',text:`${finalText}\n购买时间：${choiceLabels[state.noteChoice]}。没有修改配置、发送消息或下单。`});
    state.decision=state.noteChoice;state.noteDraft='';state.editing=null;render();
    document.querySelector('.saved-note').scrollIntoView({block:'center'});document.querySelector('#notes-title').setAttribute('tabindex','-1');document.querySelector('#notes-title').focus({preventScroll:true});
    notify('已记在这页，方案没有改动，也没有通知 Agent。');
  }
  if(event.target.id==='quick-form'){
    const input=document.querySelector('#quick-note');if(!input.value.trim()){input.setCustomValidity('写下一句话，再创建这一页。');input.reportValidity();input.setCustomValidity('');return;}createPage(input.value.trim());
  }
});
window.addEventListener('hashchange',()=>{
  state.scroll[activeRoute]=window.scrollY;activeRoute=location.hash.slice(1)||'computer';if(modal.open)closeModal();render();content.focus({preventScroll:true});window.scrollTo(0,state.scroll[activeRoute]||0);
  if(activeRoute.startsWith('page/local-')){const field=document.querySelector('#page-title');if(field&&!field.value)field.focus();}
});
render();
