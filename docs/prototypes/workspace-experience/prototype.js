/* Offline, fictional concept only. No API calls, credentials, storage or remote assets. */
'use strict';
const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  work: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 5V3h6v2M8 10h8M8 15h5"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'
};
const nav = [['overview', '总览'], ['work', '工作'], ['schedule', '日程'], ['goals', '目标']];
const seed = [
  { id: 'report', title: '研究工具选型', kind: '报告', symbol: '▤', group: 'change' },
  { id: 'meeting', title: '产品评审会', kind: '会议', symbol: '◷', group: 'change' },
  { id: 'managed', title: '整理试点访谈', kind: '访谈', symbol: '◇', group: 'continue' },
  { id: 'waiting', title: '供应商资料核对', kind: '资料', symbol: '↗', group: 'continue' },
  { id: 'closed', title: '试点问题清单', kind: '整理', symbol: '✓', group: 'closed' }
];
const initial = () => ({
  meeting: 'pending', conflict: false, latest: 2, accepted: 1, selected: 2, incoming: false,
  feedback: '', feedbackVersion: null, feedbackDraft: '', runtime: 'input', scope: 'pilot',
  filter: 'all', query: '', mode: 'normal', readonly: false, extra: [], events: [], createDraft: { title: '', context: '' }
});
let state = initial();
let currentId = null;
let lastFocus = null;
let toastTimer;
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const dialogContent = document.querySelector('#dialog-content');
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (text, action, style = '', disabled = false) => `<button type="button" class="button ${style}" data-action="${action}"${disabled ? ' disabled' : ''}>${text}</button>`;
const pill = (text, type = '') => `<span class="pill ${type}">${text}</span>`;
const allWork = () => [...seed, ...state.extra];
const findWork = (id) => allWork().find(w => w.id === id);
function description(id) {
  if (id === 'meeting') return state.meeting === 'pending'
    ? { text: '明日会议收到改期建议，原安排仍为 14:00。', source: 'Pi · 25 分钟前记录', tag: '待确认改期', tone: 'amber', needs: true }
    : state.meeting === 'applied'
      ? { text: 'Chrona 已改为 15:00；外部邀请尚未更新。', source: '你 · 刚刚确认本地安排', tag: '外部待跟进', tone: 'amber', needs: true }
      : { text: '保留明日 14:00 的安排，改期建议已忽略。', source: '你 · 刚刚记录决定', tag: '按原安排', tone: '', needs: false };
  if (id === 'report') {
    if (state.accepted === state.latest) return { text: `第 ${state.accepted} 版已接受；工作仍保持开放。`, source: '你 · 刚刚审阅', tag: '版本已接受', tone: 'green', needs: false };
    if (state.feedbackVersion === state.latest) return { text: '修改意见已记录，尚未通知外部 Agent。', source: '你 · 刚刚要求修改', tag: '待交接', tone: 'amber', needs: true };
    return { text: `第 ${state.latest} 版已交付；第 ${state.accepted} 版仍是已接受版本。`, source: state.latest === 2 ? 'Pi · 40 分钟前提交' : 'Pi · 刚刚提交（模拟）', tag: '有新成果', tone: 'green', needs: true };
  }
  if (id === 'managed') {
    const modes = {
      input: ['需要选择分析范围，托管执行已暂停。', '等待输入', 'amber', true],
      approval: ['写入共享目录前，正在等待你的权限决定。', '等待授权', 'amber', true],
      running: ['正在提取访谈主题。', '托管运行中', 'green', false],
      paused: ['执行已暂停；已完成部分仍保留。', '已暂停', '', false],
      failed: ['整理步骤失败，已提取的原始摘录仍保留。', '执行失败', 'red', true],
      denied: ['本次写入请求已拒绝，执行未继续。', '授权已拒绝', '', false],
      cancelled: ['本次执行已取消，未继续生成结果。', '执行已取消', '', false]
    };
    const [text, tag, tone, needs] = modes[state.runtime];
    return { text, tag, tone, needs, source: 'Chrona · 真实运行状态的虚构示例' };
  }
  if (id === 'waiting') return { text: '最后获知：还缺一份报价；当前进展未知。', source: '外部 Agent · 2 天前报告', tag: '等待外部消息', tone: '', needs: false };
  if (id === 'closed') return { text: '问题清单已确认，工作已明确结束。', source: '你 · 昨天结束', tag: '已结束', tone: '', needs: false };
  return { text: '已记录，未启动任何执行。', source: '你 · 刚刚记录（仅原型内存）', tag: '已记录', tone: '', needs: false };
}
function titleHeader(title, subtitle, action = true) {
  return `<header class="page-top"><div><p class="eyebrow">THURSDAY · 2026 / 09 / 17 · 虚构工作日</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action ? button('＋ 记录工作', 'create') : ''}</header>`;
}
function workRow(work) {
  const d = description(work.id);
  return `<a href="#work/${work.id}" class="work-row"><span class="work-type ${d.tone === 'amber' ? 'amber' : ''}" aria-hidden="true">${work.symbol}</span><div><h3>${escape(work.title)}</h3><p>${d.text}</p><div class="source-line">${d.source}</div></div><div class="row-end">${pill(d.tag, d.tone)}<span class="row-arrow" aria-hidden="true">↗</span></div></a>`;
}
function listGroup(title, subtitle, works) {
  if (!works.length) return '';
  return `<section class="work-group"><div class="section-head"><h2>${title}</h2><small>${subtitle}</small></div><div class="work-list">${works.map(workRow).join('')}</div></section>`;
}
function filters(includeSearch) {
  const needed = allWork().filter(w => description(w.id).needs).length;
  const choices = [['all', '全部'], ['needs', `需要我 <span class="count">${needed}</span>`], ['waiting', '等待外部'], ['closed', '已结束']];
  return `<div class="toolbar"><div class="filters" aria-label="筛选工作">${choices.map(([id, label]) => `<button type="button" class="filter" aria-pressed="${state.filter === id}" data-filter="${id}">${label}</button>`).join('')}</div>${includeSearch ? `<label><span class="skip-link">搜索工作标题</span><input id="search" class="search" type="search" value="${escape(state.query)}" placeholder="搜索工作标题" aria-label="搜索工作标题"></label>` : '<span class="muted"><small>近况来自记录，不代表远程实时状态</small></span>'}</div>`;
}
function filtered() {
  return allWork().filter(w => {
    const d = description(w.id);
    return (!state.query || w.title.includes(state.query)) && (state.filter === 'all' || (state.filter === 'needs' && d.needs) || (state.filter === 'waiting' && (w.id === 'waiting' || (w.id === 'meeting' && state.meeting === 'applied'))) || (state.filter === 'closed' && w.group === 'closed'));
  });
}
function overview(isWork) {
  const header = titleHeader(isWork ? '所有工作' : '工作总览', isWork ? '每件事只有一个位置，无论由谁推进。' : '先看最近的变化，也看那些还没有新消息的工作。');
  if (state.mode === 'loading') return `${header}<section aria-busy="true" aria-label="正在读取工作"><p class="muted">正在读取近况，暂不判断是否有新进展。</p><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton"></div></section>${button('模拟读取完成', 'restore', 'quiet')}`;
  if (state.mode === 'error') return `${header}<div class="error" role="alert"><h2>暂时无法读取工作</h2><p class="spaced">这不代表你的工作已丢失或已经结束。本原型没有真实网络请求。</p>${button('重试读取（模拟）', 'restore')}</div>`;
  if (state.mode === 'empty') return `${header}<div class="empty"><h2>从一件值得继续的工作开始</h2><p>例如跟进一次会议、完成一份报告。先记录，不会自动启动 Agent。</p>${button('记录第一件工作', 'create', 'primary')}</div>`;
  const works = filtered();
  if (!works.length) return `${header}${filters(isWork)}<div class="empty"><h2>没有匹配的工作</h2><p>这是当前筛选的结果，不代表工作区为空。</p>${button('清除筛选', 'clear-filter')}</div>`;
  if (isWork || state.filter !== 'all') return `${header}${filters(isWork)}<div class="work-list">${works.map(workRow).join('')}</div>`;
  return `${header}${filters(false)}${listGroup('最近有变化', '先看看新交付和新决定', works.filter(w => w.group === 'change'))}${listGroup('继续关注', '包括等待中的事，不把安静当成失败', works.filter(w => w.group === 'continue'))}${listGroup('最近收尾', '明确结束的工作', works.filter(w => w.group === 'closed'))}<p class="overview-note">这些条目来自虚构场景。没有进度条，也不会把“提交了成果”直接算作“工作完成”。</p>`;
}
function contextPanel(work) {
  let content;
  if (work.id === 'meeting') content = `<p><strong>明日 · ${state.meeting === 'applied' ? '15:00–15:30' : '14:00–14:30'}</strong><br>2026 年 9 月 18 日 · 上海时区<br>林晓、陈禾、我（虚构人物）</p><p>讨论试点范围与下一周的验证安排。</p><details><summary>查看相关来源与操作状态</summary><div class="source-item"><strong>会议邀请 · 邮件线程</strong><small>虚构引用 DEMO-MAIL-01；无外部链接</small></div><div class="source-item"><strong>日历邀请 · 原定 14:00</strong><small>虚构引用 DEMO-CAL-01；未同步改期</small></div><p>参与决定：Agent 报告接受<br>邮件回复：结果未知，需先核对<br>外部日历：报告接受原时间<br>会议召开：尚未召开</p><p>以上均为来源报告，不是外部操作已核实的证明。</p></details>`;
  else if (work.id === 'report') content = `<p><strong>用于「选择试点研究工具」</strong><br>比较成本、使用门槛和数据可迁移性。</p><p>由外部 Pi 提交<br>第 ${state.latest} 版为最新提交<br>第 ${state.accepted} 版已接受</p><a class="text-link" href="#goals">查看关联目标 →</a><details><summary>来源与版本说明</summary><p>提交身份来自连接；正文为贡献者内容，不包含产品授权。</p><p>版本内容不可覆盖。接受新版不会结束工作，也不会自动成为目标正式材料。</p><p>所有工具名称与数字均为设计用虚构数据。</p></details>`;
  else if (work.id === 'managed') content = `<p><strong>Chrona 托管执行</strong><br>这是有真实执行上下文时的设计形态。原型本身并未运行 Agent。</p><p>当前步骤：整理访谈主题<br>已有材料：6 份虚构摘录</p><details><summary>查看执行细节</summary><p>1. 读取摘录 · 示例已完成<br>2. 提取主题 · 当前步骤<br>3. 撰写摘要 · 尚未开始</p><p>运行范围：只读输入材料，输出独立草稿。写入共享目录需要单独批准。</p></details>`;
  else if (work.id === 'waiting') content = `<p><strong>等待星禾团队的报价</strong><br>最后报告：9 月 15 日 16:20<br>时区：Asia/Shanghai</p><p>没有实时连接到执行者，不能判断它现在是否在工作。</p><details><summary>来源与核查线索</summary><p>虚构邮件线程 DEMO-QUOTE-01。先查该线程是否已有回复，不要直接重复催问。</p></details>`;
  else content = `<p><strong>${work.id === 'closed' ? '已确认的试点准备材料' : '仅记录，不自动执行'}</strong></p><p>${escape(work.context || '无需 Provider、Plan 或 Run，也可以保存工作及后续产物。')}</p>`;
  return `<aside class="context" aria-label="工作背景"><h2>背景与来源</h2>${content}</aside>`;
}
function meetingContent() {
  if (state.meeting === 'pending') return `<section class="focus-panel"><div class="decision-tag">有一个时间变更需要你决定</div><h2>评审会往后挪一小时，可以吗？</h2><p>Pi 记录的建议：方便参与者完成上一场讨论。尚未应用。</p><div class="time-comparison"><div class="time-option"><small>当前 Chrona 安排</small><strong>14:00 – 14:30</strong><span>9 月 18 日 · 周五</span></div><div class="time-arrow" aria-hidden="true">→</div><div class="time-option proposed"><small>建议的新时间</small><strong>15:00 – 15:30</strong><span>同一天 · 上海时区</span></div></div>${state.conflict ? '<div class="error" role="alert"><strong>这条建议已过期</strong><p>记录已出现后续更新，不能继续应用旧建议。需先取得基于最新记录的新建议。</p></div>' : ''}<div class="boundary"><strong>这次确认只更新 Chrona 的时间安排。</strong><br>不会修改外部日历、回复邀请或通知参与者。邮件回复结果仍未知，跟进前先核对。</div><div class="actions">${button('仅更新 Chrona 安排', 'apply-meeting', 'primary', state.readonly || state.conflict)}${button('忽略这条建议', 'dismiss-meeting', '', state.readonly || state.conflict)}</div>${state.conflict ? `<p class="fine-print">重新读记录不等于自动重新授权。使用场景工具可模拟取得新建议。</p>` : ''}</section>`;
  if (state.meeting === 'applied') return `<div class="notice">Chrona 的安排已更新为 15:00–15:30。记录中保留了你的决定。</div><section class="focus-panel"><div class="decision-tag">还有一件事需要跟进</div><h2>外部邀请还没有同步更改</h2><p>这不是改期失败，而是另一项尚未执行的操作。</p><ul class="mini-list"><li>先核对邮件是否已经回复，避免重复发送。</li><li>再决定是否修改外部邀请和通知参与者。</li></ul><div class="boundary">Chrona 不会代你发送。把已知信息带回日常 Agent，再明确授权需要的操作。</div>${button('获取继续跟进信息', 'handoff', 'primary')}</section>`;
  return `<section class="focus-panel"><span class="decision-tag">决定已记录</span><h2>仍按明天 14:00 的安排</h2><p>你忽略了本次建议，原时间没有变化。忽略不是对外发送拒绝回复。</p>${button('查看决定记录', 'show-history')}</section>`;
}
function reportContent() {
  const n = state.selected;
  const accepted = n === state.accepted;
  const latest = n === state.latest;
  const feedbackHere = state.feedbackVersion === n;
  const options = Array.from({ length: state.latest }, (_, i) => i + 1).reverse().map(v => `<option value="${v}"${v === n ? ' selected' : ''}>第 ${v} 版${v === state.accepted ? ' · 已接受' : ''}${v === state.latest ? ' · 最新' : ''}</option>`).join('');
  return `${state.incoming ? `<div class="notice"><strong>第 ${state.latest} 版刚刚到达。</strong>你仍在阅读第 ${n} 版，不会自动切换。<div class="actions spaced">${button(`切换到第 ${state.latest} 版`, 'latest-report', 'small')}</div></div>` : ''}<div class="version-strip"><label>正在阅读 <select id="version" aria-label="选择成果版本">${options}</select></label><span>${pill(`第 ${state.accepted} 版已接受`, 'green')}</span></div>${!latest ? '<div class="warning">这是历史版本，只读。请切换到最新版本后再做审阅决定。</div>' : ''}<article class="document" aria-label="研究工具选型报告"><div class="document-kicker">RESEARCH NOTE · 虚构报告</div><h2>轻量研究工具，<br>先选可迁移的那一个。</h2><p class="muted">Pi 提交 · 第 ${n} 版 · ${n === 1 ? '昨天' : n === 2 ? '今天 16:20' : '刚刚（模拟）'}</p><blockquote>先用「青页」做两周试点，不在第一天承诺迁移全部历史资料。</blockquote><p>本轮比较青页、松石和原有文件夹流程。对于三人的试点小组，检索速度、导出完整度和维护负担，比功能数量更重要。</p><h3>为什么推荐这个方案</h3><ul><li>可以保留原始文件和来源，退出成本较低。</li><li>从现有整理方式逐步过渡，不要求先建立复杂分类。</li><li>让两名实际使用者完成同一组检索任务，再决定是否扩大使用。</li></ul>${n > 1 ? '<h3>成本与使用条件</h3><p>虚构估算：每月 ¥120 的基础费用，初次整理约 3 小时。实际费用和条件需在实施前重新核实。</p>' : ''}${n === 3 ? '<h3>根据修改意见补充</h3><p>演示负责人：林晓。验收时间：9 月 30 日。先试用 20 份虚构材料；若导出丢失来源或需要超过 2 小时人工修复，就保留原流程，不扩大迁移。</p>' : '<h3>仍需明确</h3><p>试点的具体负责人、验收日期，以及扩大使用前的退出条件。</p>'}<div class="attachment"><span aria-hidden="true">▤</span><div>对比说明 · 设计样本<br><small class="muted">正文就是本次审阅内容；没有伪装成可下载的真实附件。</small></div></div><section class="review-box" aria-label="审阅当前版本"><h3>${accepted ? `第 ${n} 版已接受` : feedbackHere ? `第 ${n} 版已有修改意见` : `第 ${n} 版可以使用了吗？`}</h3>${feedbackHere ? `<div class="warning">你的意见：${escape(state.feedback)}<br><small>意见已记录，尚未通知外部 Agent。</small></div>` : ''}<p>${accepted ? '接受的是这份版本，不是结束整件工作。后续仍可补充新的成果。' : '接受只确认本版本可用，不会结束工作或加入目标正式材料。'}</p><div class="actions">${accepted ? '' : button(`接受第 ${n} 版`, 'accept-report', 'primary', state.readonly || !latest)}${!accepted && latest ? button(feedbackHere ? '修改意见' : '写修改意见', 'feedback', '', state.readonly) : ''}${feedbackHere ? button('获取继续工作信息', 'handoff', 'quiet') : ''}</div>${state.readonly ? '<p class="fine-print">当前为只读演示，不可保存审阅决定。</p>' : ''}</section></article>`;
}
function waitingContent() {
  return `<section class="focus-panel"><div class="decision-tag">最后获知 · 两天前</div><h2>资料已收到，报价还缺一份</h2><p>这是外部 Agent 最后一次报告，不是此刻的实时进度。</p><ul class="mini-list"><li>已收到：产品说明和部署要求。</li><li>待核查：邮件线程里是否已有报价回复。</li><li>尚不确定：对方何时能提供完整材料。</li></ul><div class="boundary"><strong>当前进展未知，不等于失败。</strong><br>继续跟进前先读取原线程，不直接重复发送催问。</div>${button('获取继续跟进信息', 'handoff', 'primary')}<p class="fine-print">复制信息不会启动 Agent，也不会发送消息。</p></section>`;
}
function runtimeContent() {
  let body;
  if (state.runtime === 'input') body = `<div class="decision-tag">托管执行 · 等待输入</div><h2>这次重点分析哪些访谈？</h2><p>输入范围后，执行将从“提取主题”继续，不会重做已读取的材料。</p><form id="scope-form"><fieldset><legend>分析范围</legend><label class="radio-option"><input type="radio" name="scope" value="pilot" ${state.scope === 'pilot' ? 'checked' : ''}><span>先看试点团队<small>3 份摘录，聚焦首次使用的问题。</small></span></label><label class="radio-option"><input type="radio" name="scope" value="all" ${state.scope === 'all' ? 'checked' : ''}><span>全部访谈<small>6 份摘录，包含老用户的反馈。</small></span></label></fieldset><div class="boundary">这次提交的是内容输入，不是新的工具权限批准。恢复既有范围内的托管执行可能继续消耗 Provider 配额；本原型只模拟状态变化。</div><button class="button primary" type="submit"${state.readonly ? ' disabled' : ''}>提交输入并继续</button></form>`;
  else if (state.runtime === 'approval') body = `<div class="decision-tag">托管执行 · 等待授权</div><h2>是否允许这次写入共享目录？</h2><p>执行者申请把当前摘要写入虚构共享目录 <code>/shared/pilot/summary.md</code>。</p><div class="warning"><strong>权限决定，不是普通输入。</strong><br>允许后可能创建或覆盖该路径的文件。只批准本次，不扩大到整个会话或以后任务。</div><div class="actions">${button('仅允许本次写入', 'approve', 'primary', state.readonly)}${button('拒绝本次请求', 'deny', '', state.readonly)}</div>`;
  else if (state.runtime === 'running') body = `<span class="decision-tag">托管执行 · 示例运行中</span><h2>正在提取访谈主题</h2><p>当前只显示真实托管状态应呈现的内容，不凭时间估算完成百分比。</p><div class="boundary">这里是可观测运行的设计样本。原型没有进程、模型调用或定时推进。</div><div class="actions">${button('暂停执行', 'pause', '', state.readonly)}${button('取消本次执行', 'cancel-runtime', 'danger', state.readonly)}</div>`;
  else if (state.runtime === 'failed') body = `<span class="decision-tag">托管执行 · 失败</span><h2>主题整理未完成，摘录仍保留</h2><p>模拟错误：该步骤的模型连接中断。尚不确定最后一次输出是否完整。</p><div class="warning">先查看执行记录再决定恢复方式，避免重复写入。此原型不设计新的引擎恢复语义。</div>${button('查看执行记录', 'show-history')}`;
  else body = `<span class="decision-tag">托管执行 · ${description('managed').tag}</span><h2>${description('managed').text}</h2><p>不会因为页面打开而自行恢复。现有记录可继续查看。</p>${button('查看执行记录', 'show-history')}`;
  return `<section class="focus-panel">${body}</section>`;
}
function addEvent(id, title, content) { state.events.unshift({ id, title, content, time: '刚刚 · 你的操作（原型）' }); }
function records(work) {
  const defaults = {
    meeting: [
      ['今天 16:35 · Pi 报告', '提出改到 15:00 的建议', '仅建议修改 Chrona 时间块；原始安排未变。'],
      ['今天 15:00 · 来源报告', '邮件回复结果未知', '没有明确发送回执，不能当作已发送，也不能直接重发。'],
      ['昨天 10:20 · 你记录', '关联会议邀请与日历来源', '原定明日 14:00–14:30；未调用任何外部服务。']
    ],
    report: [
      ['今天 16:20 · Pi 提交', '交付第二版报告', '补充费用和使用条件。第一版的接受决定仍保留。'],
      ['昨天 17:00 · 你审阅', '接受第一版', '接受精确的第一版，不会自动接受未来提交。']
    ],
    managed: [['今天 16:40 · Chrona', '执行抵达用户检查点', '输入与权限审批是不同的检查点。本记录为设计样本。'], ['今天 16:30 · Chrona', '读取摘录完成', '已保留 6 份输入材料，没有对外发送。']],
    waiting: [['9 月 15 日 16:20 · 外部 Agent 报告', '还缺星禾团队报价', '已收到说明与部署要求。未知是否后来收到邮件。']],
    closed: [['昨天 18:00 · 你', '工作明确结束', '问题清单已确认，结束是独立决定。']]
  };
  const events = [...state.events.filter(e => e.id === work.id).map(e => [e.time, e.title, e.content]), ...(defaults[work.id] || [['刚刚 · 你', '记录工作', work.context || '只保存，不启动执行。']])];
  return `<section><div class="section-head"><h2>工作记录</h2><small>决定、报告和来源保留各自身份</small></div><div class="timeline">${events.map(([time, title, content], i) => `<article class="timeline-entry"><small>${escape(time)}</small><h3>${escape(title)}</h3><p>${escape(content)}</p><details><summary>查看记录引用</summary>DEMO-${escape(work.id.toUpperCase())}-${i + 1}<br>仅设计用引用，不证明任何真实外部操作。</details></article>`).join('')}</div></section>`;
}
function workDetail(id, history) {
  const work = findWork(id);
  if (!work) return `<div class="empty"><h1>这件工作不在原型中</h1><p>可能是重置后失效的本地临时链接。</p><a class="button" href="#overview">返回总览</a></div>`;
  currentId = id;
  let body = history ? records(work) : id === 'meeting' ? meetingContent() : id === 'report' ? reportContent() : id === 'waiting' ? waitingContent() : id === 'managed' ? runtimeContent() : id === 'closed'
    ? '<article class="document"><span class="document-kicker">已结束 · 虚构示例</span><h2>试点前，先回答这三个问题</h2><ol><li>是否可以完整导出原始资料？</li><li>两位实际使用者能否独立找到材料？</li><li>退出试点时，是否可以恢复原流程？</li></ol><p>这份清单已经确认。工作结束是单独的用户决定，不是收到结果后的自动动作。</p></article>'
    : `<section class="focus-panel"><span class="decision-tag">已记录</span><h2>可以从这里继续</h2><p>${escape(work.context || '暂未填写背景。')}</p><div class="boundary">这只是本地原型记录。没有创建真实任务、日程或自动化。</div>${button('获取继续工作信息', 'handoff', 'primary')}</section>`;
  return `<a class="back" href="#work">← 所有工作</a><header class="detail-heading"><div class="breadcrumbs"><span>${escape(work.kind)}</span><span>／</span><span>${id === 'managed' ? 'Chrona 托管' : '由人或外部 Agent 推进'}</span></div><h1>${escape(work.title)}</h1><p class="status-sentence">${description(id).text}</p></header><nav class="tabs" aria-label="工作内容"><a class="tab" href="#work/${id}"${!history ? ' aria-current="page"' : ''}>当前</a><a class="tab" href="#work/${id}/history"${history ? ' aria-current="page"' : ''}>记录</a></nav>${state.readonly ? '<div class="warning">只读视角：可以阅读内容，但不能提交决定或修改记录。</div>' : ''}<div class="detail-layout"><div class="detail-main">${body}</div>${contextPanel(work)}</div>`;
}
function schedulePage() {
  return `${titleHeader('日程', '时间安排和待确认建议分开显示，不把它们当作通知。', false)}<div class="schedule-day"><div class="date-label">周五<strong>18</strong>9 月</div><a class="schedule-event" href="#work/meeting"><small class="muted">${state.meeting === 'applied' ? '15:00–15:30' : '14:00–14:30'} · Asia/Shanghai</small><h2>产品评审会</h2><p>${state.meeting === 'pending' ? '另有改至 15:00 的建议，尚未应用。' : state.meeting === 'applied' ? '仅 Chrona 时间已更新，外部邀请仍需跟进。' : '维持原安排；改期建议已忽略。'}</p></a></div><p class="control-note">原型只展示局部日程汇总；完整周视图、来源日历和时区切换继续沿用正式产品设计，不在这里做假控件。</p>`;
}
function goalsPage() {
  return `${titleHeader('目标', '把日常工作放回更长的方向里，把值得复用的材料留下。', false)}<section class="goal-header"><p class="eyebrow">虚构目标 · 人工维护</p><h2>选择适合团队的研究工具</h2><p class="muted spaced">当前重点：完成小规模试点，再决定是否迁移历史资料。</p></section><div class="goal-columns"><section><div class="section-head"><h2>相关工作</h2><small>不按完成件数计算目标进度</small></div><div class="work-list">${workRow(findWork('report'))}${workRow(findWork('closed'))}</div><h2 class="spaced">什么时候才算达成</h2><ul class="criteria"><li>两位使用者能独立完成检索任务。</li><li>原始资料与来源能完整导出。</li><li>明确成本、退出条件和维护责任。</li></ul></section><section><div class="section-head"><h2>正式材料</h2><small>不等同于所有已提交成果</small></div><div class="goal-asset"><span class="work-type">▤</span><div><strong>试点验收清单</strong><small>人工确认 · 正式版本 1 · 虚构</small></div></div><div class="actions spaced">${button('阅读正式清单', 'asset', 'small')}</div><div class="boundary">工作中的报告不会因“接受”自动成为正式材料。外部成果晋升与接续仍属后续设计，此处不提供假按钮。</div></section></div>`;
}
function render(focus = false) {
  const parts = location.hash.slice(1).split('/');
  const route = ['overview', 'work', 'schedule', 'goals'].includes(parts[0]) ? parts[0] : 'overview';
  currentId = null;
  document.querySelector('#navigation').innerHTML = nav.map(([id, label]) => `<a class="nav-item" href="#${id}"${route === id ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[id]}</svg></span>${label}</a>`).join('');
  main.innerHTML = route === 'work' && parts[1] ? workDetail(parts[1], parts[2] === 'history') : route === 'schedule' ? schedulePage() : route === 'goals' ? goalsPage() : overview(route === 'work');
  document.title = `Chrona · ${currentId ? findWork(currentId)?.title : nav.find(n => n[0] === route)[1]} · 设计原型`;
  if (focus) { main.focus(); window.scrollTo(0, 0); }
}
function toast(text) {
  const el = document.querySelector('#toast');
  clearTimeout(toastTimer); el.textContent = text; el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
function openDialog(title, body) {
  if (!dialog.open) lastFocus = document.activeElement;
  dialogContent.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" data-action="close-dialog" aria-label="关闭对话框">×</button></header>${body}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { dialog.close(); }
dialog.addEventListener('close', () => { if (lastFocus?.isConnected) lastFocus.focus(); else main.focus(); });
function scenes() {
  openDialog('这是用来试想法的，不是另一套产品', `<p class="dialog-description">所有名字、报告、日期与状态都是虚构的。操作仅改变当前页面内存；刷新会重置。原型不访问生产系统，也不发送任何消息。</p><p class="scene-subtitle">按真实使用问题走一遍</p><div class="scene-grid"><a class="button" href="#work/meeting" data-close>① 会议改期：确认之后，还剩什么？</a><a class="button" href="#work/report" data-close>② 阅读报告：反馈后，Agent 知道了吗？</a><a class="button" href="#work/waiting" data-close>③ 两天没有消息：正在运行还是未知？</a><a class="button" href="#work/managed" data-close>④ 托管执行停住：要输入还是授权？</a></div><p class="scene-subtitle">场景控制 · 以下不是产品按钮</p><div class="actions">${button('模拟第三版到达', 'simulate-version', 'small', state.latest >= 3)}${button('模拟权限审批', 'simulate-approval', 'small')}${button('模拟执行失败', 'simulate-failure', 'small')}${button('模拟改期建议过期', 'simulate-conflict', 'small')}${button('模拟取得新改期建议', 'fresh-proposal', 'small')}</div><p class="scene-subtitle">边界体验</p><div class="actions">${button(state.readonly ? '恢复可编辑视角' : '切换只读视角', 'readonly', 'small')}${button('查看空工作区', 'empty', 'small')}${button('查看读取中', 'loading', 'small')}${button('查看读取失败', 'error', 'small')}${button('恢复正常读取', 'restore', 'small')}</div><hr class="divider"><p class="dialog-description">重点看：你是否知道现在发生了什么、该不该行动，以及按钮不会替你做什么。完整方案与阶段边界见本目录 README 和设计说明。</p>${button('重置整个原型', 'reset', 'quiet')}`);
}
function handoff() {
  const id = currentId || 'report';
  const w = findWork(id);
  const instructions = id === 'report' ? `阅读工作 DEMO-REPORT 的第 ${state.feedbackVersion || state.selected} 版与对应反馈。当前最新第 ${state.latest} 版；已接受第 ${state.accepted} 版。\n反馈：${state.feedback || '尚未记录修改意见，先确认本次要做什么。'}\n提交新版本，不覆盖旧内容；不要替用户接受、结束工作或晋升目标资产。`
    : id === 'meeting' ? `当前 Chrona 时间：2026-09-18 ${state.meeting === 'applied' ? '15:00–15:30' : '14:00–14:30'} Asia/Shanghai。\n外部邀请未同步改期，邮件回复结果未知。先核对原线程，避免重复发送。\n这些记录不授予发送、RSVP 或修改外部日历的权限。`
      : id === 'waiting' ? '最后报告：还缺一份报价，时间为 9 月 15 日 16:20。当前进展未知。\n先核对原线程 DEMO-QUOTE-01 是否已有回复。无新消息不是失败。\n没有授权你发送催问或安排自动跟进。' : `背景：${w?.context || '先读取已有内容，再确认需要做什么。'}\n只登记，没有启动执行或授予外部操作权限。`;
  openDialog('把上下文带回日常 Agent', `<p class="dialog-description">这是一份可手动复制的交接说明，不是“发送给 Agent”。正式实现需绑定可访问的工作链接、精确版本与权限范围；此处只有虚构引用。</p><label class="field" for="handoff-text">继续工作信息（仅演示，请勿用于真实任务）</label><textarea id="handoff-text" readonly>${escape(`【Chrona 离线原型 · 虚构，勿执行】\n工作：${w?.title || '设计工作'}\n${instructions}`)}</textarea><div class="actions">${button('选中说明，手动复制', 'select-handoff', 'primary')}${button('关闭', 'close-dialog')}</div><p class="fine-print">选择或复制文字不会发消息、唤醒 Agent，也不证明外部操作成功。</p>`);
}
function feedbackDialog() {
  openDialog(`给第 ${state.selected} 版写修改意见`, `<p class="dialog-description">保存到这个版本的审阅记录。外部 Agent 不会自动收到或开始修改。</p><form id="feedback-form"><label class="field" for="feedback">需要补充或改变什么？</label><textarea id="feedback" maxlength="2000" required placeholder="例如：补充试点负责人、验收时间和退出条件。">${escape(state.feedbackDraft)}</textarea><p id="form-error" class="form-error" role="alert"></p><div class="actions"><button class="button primary" type="submit">记录修改意见</button>${button('暂不提交', 'close-dialog')}</div><p class="fine-print">未提交文字仅保留在这次原型会话内，刷新后消失。</p></form>`);
}
function createDialog() {
  openDialog('记录一件工作', `<p class="dialog-description">先记下来，不启动执行。以后可以补来源、进展或成果；不必先选择 Agent 和流程。</p>${state.readonly ? '<div class="warning">只读视角，不能创建工作；可以关闭后继续阅读。</div>' : ''}<form id="create-form"><label class="field" for="work-title">工作名称</label><input type="text" id="work-title" maxlength="120" required placeholder="例如：整理下次评审的问题" value="${escape(state.createDraft.title)}"><label class="field" for="work-context">背景（可选）</label><textarea id="work-context" maxlength="1000" placeholder="留下下次继续时需要知道的事。">${escape(state.createDraft.context)}</textarea><p id="form-error" class="form-error" role="alert"></p><div class="boundary">本次只创建虚构本地记录，无真实 Task、日程或 Provider。正式产品中的默认也应是不自动执行。</div><div class="actions"><button class="button primary" type="submit"${state.readonly ? ' disabled' : ''}>仅记录，不执行</button>${button('取消', 'close-dialog')}</div></form>`);
}
function mutateAllowed() {
  if (state.readonly) { toast('当前只读，未保存任何决定。'); return false; }
  return true;
}
const actions = {
  scenes, handoff,
  'close-dialog': closeDialog,
  'select-handoff': () => { const field = document.querySelector('#handoff-text'); field.focus(); field.select(); toast('已选中。请用系统复制快捷键；没有发送给任何人。'); },
  create: createDialog,
  feedback: () => { if (mutateAllowed() && state.selected === state.latest) feedbackDialog(); },
  'apply-meeting': () => {
    if (!mutateAllowed() || state.conflict || state.meeting !== 'pending') return;
    openDialog('只更新 Chrona 的安排', `<p>把 9 月 18 日的 <strong>14:00–14:30</strong> 改为 <strong>15:00–15:30</strong>（Asia/Shanghai）。</p><div class="boundary">外部日历和邮件不会改变。你对参与的决定也不会因此重新发送。</div><div class="actions">${button('确认更新本地安排', 'confirm-meeting', 'primary')}${button('返回', 'close-dialog')}</div>`);
  },
  'confirm-meeting': () => {
    if (!mutateAllowed() || state.conflict || state.meeting !== 'pending') return;
    state.meeting = 'applied'; addEvent('meeting', '更新 Chrona 本地时间', '14:00–14:30 → 15:00–15:30。未改外部日历、未发送邮件。'); closeDialog(); render(); main.focus(); toast('已模拟更新本地安排。外部邀请仍需跟进。');
  },
  'dismiss-meeting': () => { if (!mutateAllowed() || state.conflict) return; state.meeting = 'dismissed'; addEvent('meeting', '忽略改期建议', '保留原安排；没有发送拒绝回复。'); render(); main.focus(); },
  'show-history': () => { location.hash = `work/${currentId}/history`; },
  'latest-report': () => { state.selected = state.latest; state.incoming = false; render(); main.focus(); },
  'accept-report': () => {
    if (!mutateAllowed() || state.selected !== state.latest) return;
    const version = state.selected;
    openDialog(`接受第 ${version} 版`, `<p>你正在确认第 ${version} 版可以使用。此前第 ${state.accepted} 版的接受记录与内容仍会保留。</p><div class="boundary">不会结束这件工作，不会自动成为目标的正式材料，也不会通知外部 Agent。</div><div class="actions">${button(`确认接受第 ${version} 版`, 'confirm-accept', 'primary')}${button('继续阅读', 'close-dialog')}</div>`);
    dialogContent.dataset.targetVersion = String(version);
  },
  'confirm-accept': () => {
    const version = Number(dialogContent.dataset.targetVersion);
    if (!mutateAllowed()) return;
    if (version !== state.latest || version !== state.selected) { toast('阅读版本已改变，请重新审阅后确认。'); closeDialog(); return; }
    state.accepted = version; addEvent('report', `接受第 ${version} 版`, '接受精确版本；工作仍开放，未成为目标正式材料。'); closeDialog(); render(); main.focus(); toast(`第 ${version} 版已模拟接受，工作仍然开放。`);
  },
  'simulate-version': () => {
    if (state.latest >= 3) return;
    state.latest = 3; state.incoming = state.selected !== 3; addEvent('report', 'Pi 提交第三版（场景模拟）', '补充负责人、验收日期与退出条件。旧接受指针保持。'); closeDialog();
    if (!location.hash.startsWith('#work/report')) location.hash = 'work/report'; else render();
    toast('模拟第三版到达；你阅读的版本没有自动切换。');
  },
  'simulate-approval': () => { state.runtime = 'approval'; closeDialog(); location.hash = 'work/managed'; render(); },
  'simulate-failure': () => { state.runtime = 'failed'; closeDialog(); location.hash = 'work/managed'; render(); },
  'simulate-conflict': () => { state.meeting = 'pending'; state.conflict = true; closeDialog(); location.hash = 'work/meeting'; render(); },
  'fresh-proposal': () => { state.meeting = 'pending'; state.conflict = false; addEvent('meeting', '模拟收到一条基于最新记录的新建议', '这不是自动给旧建议换 revision；仍需重新做决定。'); closeDialog(); location.hash = 'work/meeting'; render(); },
  readonly: () => { state.readonly = !state.readonly; closeDialog(); render(); },
  approve: () => { if (!mutateAllowed()) return; state.runtime = 'running'; addEvent('managed', '允许本次写入（模拟）', '仅本次虚构路径，不扩大后续权限。'); render(); main.focus(); },
  deny: () => { if (!mutateAllowed()) return; state.runtime = 'denied'; addEvent('managed', '拒绝本次权限请求', '执行未继续，未写入任何文件。'); render(); main.focus(); },
  pause: () => { if (!mutateAllowed()) return; state.runtime = 'paused'; addEvent('managed', '暂停托管执行（模拟）', '保留已完成部分。'); render(); main.focus(); },
  'cancel-runtime': () => {
    if (!mutateAllowed()) return;
    openDialog('取消本次执行？', `<p>本次执行不会继续。已经生成的记录仍保留；取消不代表这件工作已完成。</p><div class="actions">${button('确认取消执行', 'confirm-cancel', 'danger')}${button('返回', 'close-dialog')}</div>`);
  },
  'confirm-cancel': () => { if (!mutateAllowed()) return; state.runtime = 'cancelled'; addEvent('managed', '取消本次执行（模拟）', '不是结束整件工作。'); closeDialog(); render(); main.focus(); },
  'clear-filter': () => { state.filter = 'all'; state.query = ''; render(); },
  restore: () => { state.mode = 'normal'; closeDialog(); render(); },
  reset: () => { state = initial(); closeDialog(); location.hash = 'overview'; render(); toast('虚构场景已重置。'); },
  asset: () => openDialog('试点验收清单 · 正式版本 1', '<p class="dialog-description">虚构的人确认材料；不是把刚交付的报告自动提升为资产。</p><ol class="body-copy"><li>材料与出处可完整导出。</li><li>两位参与者能独立完成检索。</li><li>明确维护负责人、成本和退出方式。</li></ol><p class="fine-print">原型只阅读；正式资产编辑与版本规则保持既有 Goal Workbench 语义。</p>')
};
for (const mode of ['empty', 'loading', 'error']) actions[mode] = () => { state.mode = mode; closeDialog(); location.hash = 'overview'; render(); };
document.addEventListener('click', event => {
  if (event.target.closest('a.skip-link')) { event.preventDefault(); main.focus(); return; }
  const action = event.target.closest('[data-action]');
  if (action && !action.disabled) { actions[action.dataset.action]?.(); return; }
  const filter = event.target.closest('[data-filter]');
  if (filter) { state.filter = filter.dataset.filter; render(); document.querySelector(`[data-filter="${state.filter}"]`)?.focus(); }
  if (event.target.closest('[data-close]')) closeDialog();
});
document.addEventListener('input', event => {
  const { id, value } = event.target;
  if (id === 'feedback') state.feedbackDraft = value;
  if (id === 'work-title') state.createDraft.title = value;
  if (id === 'work-context') state.createDraft.context = value;
  if (id === 'search') {
    const position = event.target.selectionStart;
    state.query = value; render(); const input = document.querySelector('#search'); input.focus(); if (position !== null) input.setSelectionRange(position, position);
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'version') { state.selected = Number(event.target.value); state.incoming = state.selected !== state.latest; render(); document.querySelector('#version')?.focus(); }
  if (event.target.name === 'scope') state.scope = event.target.value;
});
document.addEventListener('submit', event => {
  event.preventDefault();
  if (!mutateAllowed()) return;
  if (event.target.id === 'feedback-form') {
    const text = state.feedbackDraft.trim();
    if (!text) { document.querySelector('#form-error').textContent = '请写下具体需要修改的地方。'; return; }
    state.feedback = text; state.feedbackVersion = state.selected; addEvent('report', `给第 ${state.selected} 版记录修改意见`, `${text} 尚未通知外部 Agent。`); closeDialog(); render(); main.focus(); toast('意见已记录（模拟）；尚未通知外部 Agent。');
  } else if (event.target.id === 'create-form') {
    const title = state.createDraft.title.trim();
    if (!title) { document.querySelector('#form-error').textContent = '请填写工作名称。'; return; }
    const id = `local-${state.extra.length + 1}`;
    state.extra.push({ id, title, context: state.createDraft.context.trim(), kind: '记录', symbol: '＋', group: 'continue' }); state.createDraft = { title: '', context: '' }; state.mode = 'normal'; closeDialog(); location.hash = `work/${id}`;
  } else if (event.target.id === 'scope-form') {
    if (state.runtime !== 'input') return;
    state.runtime = 'running'; addEvent('managed', '提交分析范围（模拟）', state.scope === 'pilot' ? '只分析试点团队。' : '分析全部访谈。'); render(); main.focus(); toast('示例状态已继续；没有调用 Provider。');
  }
});
window.addEventListener('hashchange', () => { if (dialog.open) closeDialog(); render(true); });
render();
