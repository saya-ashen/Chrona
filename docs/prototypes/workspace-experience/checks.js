/* Optional in-browser interaction checks. Load only on this offline prototype.
 * Run via Chrome DevTools MCP evaluate_script; no production URLs or dependencies.
 * Does not claim to test real services, authorization, accessibility compliance or user comprehension.
 */
window.runPrototypeChecks = async function runPrototypeChecks() {
  if (location.hostname !== '127.0.0.1' || !document.title.includes('设计原型')) throw new Error('Only local prototype allowed');
  const results = [];
  const tick = () => new Promise(resolve => setTimeout(resolve, 45));
  const assert = (name, condition) => { results.push({ name, pass: !!condition }); if (!condition) throw new Error(name); };
  const text = () => document.querySelector('main').innerText;
  const click = async selector => {
    const el = document.querySelector(selector);
    if (!el || el.disabled) throw new Error(`Missing or disabled: ${selector}`);
    el.click(); await tick();
  };
  const action = id => click(`[data-action="${id}"]`);
  const route = async path => { location.hash = path; await tick(); };
  const input = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const reset = async () => { await action('scenes'); await action('reset'); await tick(); };
  try {
    await reset();
    assert('homepage is overall work, not approval queue', document.querySelector('h1').textContent === '工作总览' && document.querySelectorAll('.work-row').length === 5);
    assert('four main navigation entries', document.querySelectorAll('#navigation a').length === 4);
    assert('known external silence remains unknown', text().includes('当前进展未知'));
    await click('[data-filter="needs"]');
    assert('three actionable work items', document.querySelectorAll('.work-row').length === 3);
    await route('work/meeting');
    assert('local-only consequence visible before action', text().includes('不会修改外部日历、回复邀请或通知参与者'));
    await action('apply-meeting');
    assert('confirmation dialog open', document.querySelector('dialog').open);
    await action('confirm-meeting');
    assert('meeting advances but external operation stays pending', text().includes('外部邀请还没有同步更改') && text().includes('15:00–15:30'));
    await route('schedule');
    assert('same work and changed time in schedule', text().includes('15:00–15:30') && document.querySelector('a[href="#work/meeting"]'));
    await route('work/meeting/history');
    assert('decision history keeps operation boundary', text().includes('未改外部日历、未发送邮件'));
    await route('work/report');
    assert('report body visible and old acceptance retained', text().includes('轻量研究工具') && text().includes('第 1 版已接受'));
    await action('feedback');
    input('#feedback', '请补充试点负责人、验收时间与退出条件。');
    await action('close-dialog');
    await action('feedback');
    assert('unsubmitted feedback survives dialog close', document.querySelector('#feedback').value.includes('退出条件'));
    document.querySelector('#feedback-form').requestSubmit(); await tick();
    assert('saved feedback does not pretend to notify agent', text().includes('尚未通知外部 Agent') && text().includes('第 2 版已有修改意见'));
    await action('handoff');
    assert('handoff includes exact version, feedback, no implicit acceptance', document.querySelector('#handoff-text').value.includes('第 2 版') && document.querySelector('#handoff-text').value.includes('不要替用户接受'));
    await action('select-handoff');
    assert('manual copy selects handoff, no automatic send', document.querySelector('#handoff-text').selectionEnd > 0);
    await action('close-dialog');
    await action('scenes'); await action('simulate-version');
    assert('new version arrival preserves reading version', document.querySelector('#version').value === '2' && text().includes('第 3 版刚刚到达'));
    assert('cannot review stale version', document.querySelector('[data-action="accept-report"]').disabled);
    await action('latest-report');
    assert('explicit latest selection, accepted pointer unchanged', document.querySelector('#version').value === '3' && text().includes('第 1 版已接受'));
    await action('accept-report'); await action('confirm-accept');
    assert('exact version accepted, task not closed', text().includes('第 3 版已接受') && text().includes('工作仍保持开放'));
    const select = document.querySelector('#version'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    assert('old version still readable and immutable', document.querySelector('#version').value === '1' && text().includes('这是历史版本，只读'));
    await route('work/waiting');
    assert('no fake pause or restart for external work', !document.querySelector('[data-action="pause"]') && !document.querySelector('[data-action="cancel-runtime"]') && text().includes('当前进展未知'));
    await route('work/managed');
    assert('input not permission authorization', text().includes('不是新的工具权限批准'));
    document.querySelector('#scope-form').requestSubmit(); await tick();
    assert('explicit input advances mock run', text().includes('正在提取访谈主题'));
    await action('pause');
    assert('pause retained distinctly from completed', text().includes('已暂停') && !text().includes('工作已明确结束'));
    await action('scenes'); await action('simulate-approval');
    assert('authorization exposes scope and overwrite risk', text().includes('/shared/pilot/summary.md') && text().includes('创建或覆盖'));
    await action('deny');
    assert('permission rejection does not continue run', text().includes('授权已拒绝'));
    await action('scenes'); await action('simulate-failure');
    assert('failure retains prior output, does not invent retry safety', text().includes('摘录仍保留') && text().includes('避免重复写入'));
    await action('scenes'); await action('simulate-conflict');
    assert('stale proposal cannot be applied', document.querySelector('[data-action="apply-meeting"]').disabled && text().includes('建议已过期'));
    await action('scenes'); await action('fresh-proposal');
    assert('new proposal requires new decision', !document.querySelector('[data-action="apply-meeting"]').disabled);
    await action('scenes'); await action('readonly');
    assert('read-only view visibly disables mutations', document.querySelector('[data-action="apply-meeting"]').disabled && text().includes('只读视角'));
    await action('scenes'); await action('readonly');
    await route('goals');
    assert('accepted result is not goal asset promotion', text().includes('不会因“接受”自动成为正式材料'));
    await action('asset');
    assert('formal asset reader opens', document.querySelector('dialog').open && document.querySelector('#dialog-title').textContent.includes('正式版本 1'));
    await action('close-dialog');
    await route('work'); input('#search', '不存在的标题'); await tick();
    assert('filter empty distinct from no workspace data', text().includes('当前筛选的结果'));
    await action('clear-filter');
    await action('create'); input('#work-title', '<b>新的设计工作</b>'); input('#work-context', '只登记，不执行。');
    document.querySelector('#create-form').requestSubmit(); await tick();
    assert('create records local work without executing', text().includes('没有创建真实任务、日程或自动化'));
    assert('editable text escaped, not rendered as markup', document.querySelector('h1').textContent === '<b>新的设计工作</b>' && !document.querySelector('h1 b'));
    const beforeSkip = location.hash; await click('a.skip-link');
    assert('skip link preserves current route and focuses main', location.hash === beforeSkip && document.activeElement.id === 'main');
    for (const mode of ['empty', 'loading', 'error']) {
      await action('scenes'); await action(mode);
      assert(`boundary state ${mode}`, mode === 'empty' ? text().includes('从一件值得继续的工作开始') : mode === 'loading' ? !!document.querySelector('[aria-busy="true"]') : text().includes('暂时无法读取工作'));
      await action('scenes'); await action('restore');
    }
    await reset();
    const pages = ['overview', 'work', 'work/meeting', 'work/report', 'work/report/history', 'work/waiting', 'work/managed', 'work/closed', 'schedule', 'goals'];
    for (const path of pages) {
      await route(path);
      assert(`no horizontal overflow: ${path}`, document.documentElement.scrollWidth <= innerWidth);
      assert(`one main heading: ${path}`, document.querySelectorAll('main h1').length === 1);
    }
    await route('overview');
    const remote = performance.getEntriesByType('resource').filter(r => !r.name.startsWith(location.origin + '/'));
    assert('prototype resources all local', remote.length === 0);
    return { viewport: [innerWidth, innerHeight], passed: results.length, failed: 0, checks: results };
  } catch (error) {
    return { viewport: [innerWidth, innerHeight], passed: results.filter(r => r.pass).length, failed: 1, error: String(error), checks: results };
  }
};
