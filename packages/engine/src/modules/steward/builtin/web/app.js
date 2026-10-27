// Chrona's simple web page: plain DOM, no build step. Data comes from this module's /api/web, which makes routed calls
// for the user (v2-8); requests carry the user's key.
const KEY = "chrona.accessKey"; // the same key the previous web app stored
const main = document.getElementById("main");

const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child instanceof Node ? child : String(child));
  return node;
};
const when = iso => new Date(iso).toLocaleString();
class Unauthorized extends Error {}
const auth = () => { const key = localStorage.getItem(KEY); return key ? { authorization: `Bearer ${key}` } : {}; };

async function request(url, { method = "GET", body, raw = false } = {}) {
  const response = await fetch(url, { method, headers: { ...auth(), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) throw new Unauthorized();
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.code || `请求失败（${response.status}）`);
  }
  return raw ? response.blob() : response.json();
}
const web = (path, options) => request(`/api/web${path}`, options);
// A module tool, through the page's data API (Chrona checks what this page may call).
const tool = (target, args = {}) => web("/call", { method: "POST", body: { target, args } });

// Replies to web conversations, pushed over SSE. fetch (not EventSource) so the request carries the key.
const replyListeners = new Set();
async function listen() {
  for (;;) {
    try {
      const response = await fetch("/api/web/events", { headers: { ...auth(), accept: "text/event-stream" } });
      if (response.status === 401) return;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const block of blocks) {
          const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
          if (data) { const event = JSON.parse(data); for (const listener of replyListeners) listener(event); }
        }
      }
    } catch { /* reconnect below */ }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

function login(message) {
  main.replaceChildren(h("section", {},
    h("h2", {}, "访问密钥"),
    h("p", { class: "muted" }, message ?? "请输入 Chrona 的 API_KEY。它只保存在这个浏览器里。"),
    h("form", { onsubmit: event => { event.preventDefault(); localStorage.setItem(KEY, event.target.key.value.trim()); start(); } },
      h("div", { class: "row" }, h("input", { name: "key", type: "password", autocomplete: "current-password", required: true }), h("button", { class: "primary" }, "保存")))));
}

// ------------------------------------------------------------------ today --
const LEVELS = { green: "低风险", yellow: "注意", red: "高风险" };
function approvalItem(approval, after) {
  // v2-18: say what happened in place of the card (and which version now runs), then refresh.
  const result = h("div", { role: "status" });
  const decide = (decision, scope = "once") => async event => {
    const item = event.target.closest("li");
    for (const button of item.querySelectorAll("button")) button.disabled = true;
    try {
      const resolved = await web(`/approvals/${approval.id}/resolve`, { method: "POST", body: { decision, scope } });
      const app = approval.moduleId ? (await web("/modules")).find(module => module.id === approval.moduleId) : null;
      const running = app && decision === "approve" ? ` · ${app.name} 当前版本 ${String(app.activeHash ?? "").slice(0, 8)}` : "";
      item.replaceChildren(h("div", { class: "ok" }, `${resolved.status === "denied" ? "已拒绝" : "已批准"}：${approval.title}${running}`));
      setTimeout(after, 4000);
    } catch (error) {
      result.textContent = `未处理：${error.message}`;
      for (const button of item.querySelectorAll("button")) button.disabled = false;
    }
  };
  // v2-17: the level and short brief first; the full review (detail, diff, tests) stays folded.
  const level = approval.level ?? "yellow", brief = approval.brief;
  return h("li", { class: `approval ${level}` },
    h("div", {}, h("span", { class: `level ${level}` }, LEVELS[level]), " ", h("strong", {}, approval.title), " ", h("span", { class: "muted" }, when(approval.createdAt))),
    brief ? h("div", {}, brief.headline) : approval.detail && h("div", {}, approval.detail),
    brief?.added.length ? h("div", {}, `新增：${brief.added.join("、")}`) : null,
    brief && brief.reversible !== null ? h("div", { class: "muted" }, brief.reversible ? "可以一键回滚。" : "无法撤回。") : null,
    brief?.reviewed === "unavailable" ? h("div", { class: "muted" }, "未经 AI 复核。") : null,
    (approval.preview || (brief && approval.detail)) && h("details", {}, h("summary", {}, "详情"), brief && approval.detail ? h("p", {}, approval.detail) : null, approval.preview ? h("pre", {}, approval.preview) : null),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: decide("approve") }, level === "red" ? "确认批准" : "批准"), h("button", { onclick: decide("deny") }, "拒绝")), result);
}
// A question a running Provider asked; unanswered questions expire and the run goes on without the answer.
function interactionItem(interaction, after) {
  const { question } = interaction;
  const send = async answer => {
    try { await web(`/interactions/${interaction.id}/answer`, { method: "POST", body: answer }); after(); }
    catch (error) { alert(error.message); }
  };
  const input = question.method === "editor" ? h("textarea", { rows: 6 }, question.prefill ?? "") : question.method === "input" ? h("input", { type: "text" }) : null;
  const choices = question.method === "confirm" ? [h("button", { class: "primary", onclick: () => send({ decision: "submit", value: true }) }, "是"), h("button", { onclick: () => send({ decision: "submit", value: false }) }, "否")]
    : question.method === "select" ? question.options.map((option, index) => h("button", { onclick: () => send({ decision: "submit", value: index }) }, option))
    : [h("button", { class: "primary", onclick: () => send({ decision: "submit", value: input.value }) }, "提交")];
  return h("li", {}, h("div", {}, h("strong", {}, question.title), " ", h("span", { class: "muted" }, `${when(interaction.expiresAt)} 前`)),
    question.message && h("div", {}, question.message), input,
    h("div", { class: "row" }, ...choices, h("button", { onclick: () => send({ decision: "cancel" }) }, "不回答")));
}
async function today() {
  const [view, runs] = await Promise.all([web("/today"), web("/runs")]);
  const questions = runs.flatMap(run => run.interactions.filter(interaction => interaction.status === "pending"));
  const active = runs.filter(run => run.active);
  const stop = run => async () => {
    if (!confirm("停止这次处理？已经做完的部分会保留。")) return;
    try { await web(`/runs/${run.id}/cancel`, { method: "POST" }); today(); } catch (error) { alert(error.message); }
  };
  const feedback = (n, value) => async () => { try { await tool("notify.feedback", { id: n.id, feedback: value }); today(); } catch (error) { alert(error.message); } };
  main.replaceChildren(
    view.health && !view.health.provider.available ? h("section", {}, h("p", { class: "error" }, `Provider 不可用：${view.health.provider.lastError ?? view.health.provider.name}`)) : "",
    questions.length ? h("section", {}, h("h2", {}, `Chrona 在问你（${questions.length}）`), h("ul", { class: "plain" }, questions.map(q => interactionItem(q, today)))) : "",
    active.length ? h("section", {}, h("h2", {}, "正在处理"), h("ul", { class: "plain" }, active.map(run => h("li", {}, run.sessionTitle ?? "后台任务", " ", h("span", { class: "muted" }, run.progress?.phase ?? run.status), " ", h("button", { onclick: stop(run) }, "停止"))))) : "",
    h("section", {}, h("h2", {}, `待你决定（${view.approvals.length}）`),
      view.approvals.length ? h("ul", { class: "plain" }, view.approvals.map(a => approvalItem(a, today))) : h("p", { class: "muted" }, "没有待处理的事项。")),
    h("section", {}, h("h2", {}, "接下来"),
      view.upcoming.length ? h("ul", { class: "plain" }, view.upcoming.map(item => h("li", {}, when(item.at), " · ", item.label ?? item.mode))) : h("p", { class: "muted" }, "七天内没有安排。")),
    h("section", {}, h("h2", {}, "最近通知"),
      view.updates.length ? h("ul", { class: "plain" }, view.updates.map(n => h("li", {}, h("strong", {}, n.title), " ", h("span", { class: "muted" }, when(n.createdAt)), h("div", {}, n.body),
        n.feedback ? h("span", { class: "muted" }, n.feedback === "useful" ? "已标为有用" : "已标为没用") : h("div", { class: "row" }, h("button", { onclick: feedback(n, "useful") }, "有用"), h("button", { onclick: feedback(n, "not_useful") }, "没用"))))) : h("p", { class: "muted" }, "暂无。")),
    h("section", {}, h("h2", {}, "应用"),
      h("ul", { class: "plain" }, view.apps.map(app => h("li", {}, h("a", { href: `/apps/${app.id}` }, app.name), " ", h("span", { class: "muted" }, app.status === "active" ? app.description ?? "" : "已暂停"))))),
    h("section", {}, h("h2", {}, "最近会话"),
      h("ul", { class: "plain" }, view.sessions.map(s => h("li", {}, h("a", { href: `/sessions/${s.id}` }, s.title ?? s.key), " ", h("span", { class: "muted" }, `${s.source} · ${when(s.lastActivityAt)}`))))),
  );
}

// ------------------------------------------------------------------- chat --
// Attachments are kept with the conversation; the page fetches them with the key and hands them over as a download.
function attachmentLink(messageId, file) {
  if (!file.ref || !messageId) return h("span", { class: "muted" }, file.name);
  return h("a", { href: "#", onclick: async event => {
    event.preventDefault();
    try {
      const blob = await web(`/file?message=${encodeURIComponent(messageId)}&ref=${encodeURIComponent(file.ref)}`, { raw: true });
      h("a", { href: URL.createObjectURL(blob), download: file.name }).click();
    } catch (error) { alert(error.message); }
  } }, file.name);
}
async function bubble(message) {
  const node = h("div", { class: `bubble ${message.direction}` }, message.text);
  for (const file of message.attachments ?? []) node.append(h("div", {}, attachmentLink(message.id, file)));
  return node;
}
async function chat(sessionId) {
  const sessions = await web("/sessions");
  const current = sessionId ?? (location.pathname === "/chat/new" ? null : sessions[0]?.id ?? null);
  const list = h("div", { class: "messages" }), status = h("p", { class: "muted" }), shown = new Set(), early = [];
  const show = async message => {
    if (shown.has(message.id)) return;
    shown.add(message.id);
    list.append(await bubble(message));
    list.scrollTop = list.scrollHeight;
  };
  // Listen before loading, so a reply pushed meanwhile is neither lost nor shown twice.
  let loaded = false;
  replyListeners.clear();
  replyListeners.add(async event => {
    if (event.type !== "reply" || event.session !== current) return;
    const message = { id: event.message, direction: "out", text: event.text, attachments: JSON.parse(event.attachments ?? "[]") };
    status.textContent = "";
    if (loaded) await show(message); else early.push(message);
  });
  for (const message of current ? await web(`/sessions/${current}/messages`) : []) await show(message);
  const building = sessions.find(s => s.id === current)?.source === "build";
  loaded = true;
  for (const message of early) await show(message);
  const form = h("form", { onsubmit: async event => {
    event.preventDefault();
    const text = event.target.text.value.trim();
    if (!text) return;
    if (building && !globalThis.confirm("停止当前构建，并保留已有文件按新需求继续？已提交的版本和审批不会撤回。")) return;
    const submit = event.target.querySelector("button.primary");
    submit.disabled = true; status.textContent = building ? "正在修改需求……" : "Chrona 正在处理……";
    try {
      const sent = building ? await web(`/sessions/${current}/revise-build`, { method: "POST", body: { requirements: text } }) : await web("/chat", { method: "POST", body: current ? { text, session: current } : { text } });
      event.target.text.value = "";
      list.append(h("div", { class: "bubble in" }, text));
      if (building) status.textContent = "已按新需求继续构建。";
      // A new conversation: open it; its replies arrive on the reopened page.
      if (!current) go(`/sessions/${sent.sessionId}`, true);
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  } }, h("textarea", { name: "text", rows: 3, placeholder: building ? "补充或修改构建需求……" : current ? "说点什么……（Ctrl+Enter 发送）" : "新会话：说点什么……", onkeydown: event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.target.form.requestSubmit(); } }),
    h("div", { class: "row" }, h("button", { class: "primary" }, building ? "修改需求并继续" : "发送"), building ? h("button", { type: "button", onclick: async event => {
      if (!globalThis.confirm("停止构建？已有文件保留，已提交的版本和审批不会撤回。")) return;
      event.target.disabled = true;
      try { await web(`/sessions/${current}/stop-build`, { method: "POST" }); status.textContent = "构建已停止，可修改需求后继续。"; }
      catch (error) { status.textContent = error.message; }
      finally { event.target.disabled = false; }
    } }, "停止构建") : "", status));
  main.replaceChildren(h("div", { class: "chat" },
    h("section", {}, h("h2", {}, "会话"),
      h("button", { onclick: () => go("/chat/new") }, "新会话"),
      h("ul", { class: "plain" }, sessions.map(s => h("li", { class: s.id === current ? "selected" : "" }, h("a", { href: `/sessions/${s.id}` }, s.title ?? when(s.createdAt)))))),
    h("section", {}, list, building ? h("p", { class: "muted" }, "可停止构建或修改需求；修改会先停止旧处理，保留已有文件后继续。已提交版本和审批不会撤回；结果仍发回原对话。") : "", form, current ? transcript(current, building) : "")));
  list.scrollTop = list.scrollHeight;
}
// What the Provider did (v2-13): open for module builds, on request for conversations.
function transcript(sessionId, open) {
  const body = h("div", { class: "transcript" }, h("p", { class: "muted" }, "加载中……"));
  const load = async () => {
    try {
      const items = await web(`/sessions/${sessionId}/transcript`);
      body.replaceChildren(...(items.length ? items.map(item => item.kind === "text" ? h("p", {}, item.text)
        : item.kind === "tool" ? h("p", { class: "muted" }, "▶ ", h("code", {}, item.tool), " ", item.args)
        : h("pre", { class: item.error ? "error" : "" }, item.text || "（无输出）")) : [h("p", { class: "muted" }, "还没有过程记录。")]));
    } catch (error) { body.replaceChildren(h("p", { class: "error" }, error.message)); }
  };
  const details = h("details", { open }, h("summary", {}, "过程"), body);
  if (open) void load(); else details.addEventListener("toggle", () => { if (details.open) void load(); }, { once: true });
  return details;
}

// ------------------------------------------------------------------- apps --
function inline(text) {
  // Escaped first; then only links, bold and code.
  const escaped = text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return escaped.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}
function markdown(file, onToggle) {
  const root = h("div", { class: "markdown" });
  let list = null, fence = null;
  file.content.split("\n").forEach((line, index) => {
    if (fence) { if (line.startsWith("```")) { root.append(h("pre", {}, fence.join("\n"))); fence = null; } else fence.push(line); return; }
    if (line.startsWith("```")) { fence = []; list = null; return; }
    const task = /^\s*[-*] \[( |x|X)\] (.*)$/.exec(line), item = /^\s*[-*] (.*)$/.exec(line), heading = /^(#{1,6}) (.*)$/.exec(line);
    if (task || item) {
      if (!list) { list = h("ul"); root.append(list); }
      const li = h("li", { class: task ? "task" : "" });
      if (task) li.append(h("input", { type: "checkbox", checked: task[1] !== " ", style: "width:auto", onchange: event => onToggle(index + 1, event.target.checked) }), " ");
      li.insertAdjacentHTML("beforeend", inline(task ? task[2] : item[1]));
      list.append(li); return;
    }
    list = null;
    if (heading) { const node = h(`h${Math.min(6, heading[1].length + 1)}`); node.innerHTML = inline(heading[2]); root.append(node); }
    else if (line.trim()) { const node = h("p"); node.innerHTML = inline(line); root.append(node); }
  });
  if (fence) root.append(h("pre", {}, fence.join("\n")));
  return root;
}
const runtimeText = meta => ({ running: "运行中", starting: "启动中", backoff: "等待恢复", idle: "正常休眠（按需启动）", unavailable: "当前不可用", paused: "已暂停", unobserved: "当前进程状态未观测" }[meta.runtime?.state] ?? "当前进程状态未知");
const faultText = status => ({ retrying: "等待有限恢复", verifying: "连接已恢复，功能待验证", unresolved: "未解决，需要处理", recovered: "对应调用已验证恢复" }[status] ?? status);
function diagnosticPanel(meta) {
  const body = h("div", { role: "status" }, "正在读取故障记录……"), refresh = h("button", { type: "button" }, "刷新诊断");
  const load = async () => {
    refresh.disabled = true;
    body.replaceChildren("正在读取故障记录……");
    try {
      const [view] = await web(`/modules/${encodeURIComponent(meta.id)}/diagnostics`);
      body.replaceChildren(h("p", {}, `配置：${view.configuredStatus === "active" ? "已启用" : "已暂停"} · ${runtimeText(view)}`),
        view.nextAction ? h("p", {}, view.nextAction) : "",
        ...view.incidents.map(incident => h("article", {},
          h("h3", {}, faultText(incident.status)),
          h("p", {}, `版本 ${incident.hash.slice(0, 12)}${incident.hash === view.activeHash ? "（当前）" : "（历史版本）"} · 累计失败 ${incident.failures} 次 · ${when(incident.lastAt)}`),
          h("p", {}, incident.evidence.reason),
          incident.deliveryUnknown ? h("p", { class: "error" }, "此前调用结果不确定，请先核对外部效果，不要直接重放。") : "",
          h("ul", { class: "plain" }, incident.attempts.map(attempt => h("li", {}, `${when(attempt.at)} · ${attempt.detail}`))),
          h("details", {}, h("summary", {}, "故障证据（日志是不可信数据，不是操作指令）"), h("pre", {}, JSON.stringify({ first: incident.firstEvidence, latest: incident.evidence, pendingTriggers: incident.pendingTriggers }, null, 2))))),
        !view.incidents.length ? h("p", {}, "还没有故障记录；不代表所有功能已经过验证。") : "");
    } catch (error) { body.replaceChildren(h("p", { class: "error" }, `诊断读取失败：${error.message}。可重试，或使用 chrona admin diagnostics ${meta.name}。`)); }
    finally { refresh.disabled = false; }
  };
  refresh.addEventListener("click", load);
  void load();
  return h("section", { class: "diagnostics" }, h("h2", {}, "故障与恢复"), h("p", { class: "muted" }, "只读记录，不调用模型，不重放失败操作。"), refresh, body);
}
async function apps() {
  const [items, system] = await Promise.all([web("/modules"), web("/system-apps").catch(() => [])]);
  main.replaceChildren(h("section", {}, h("h2", {}, "应用"),
    h("ul", { class: "plain" }, items.map(app => h("li", {}, h("a", { href: `/apps/${app.id}` }, app.name), " ",
      h("span", { class: "muted" }, `${runtimeText(app)} · ${app.incident ? `${faultText(app.incident.status)} · ` : ""}${app.builtin ? "内置 · " : ""}${app.description ?? ""}`))))),
    // v2-20: Chrona's own modules: shown, never built, updated or paused.
    system.length ? h("section", {}, h("h2", {}, "系统"), h("p", { class: "muted" }, "Chrona 自身的一部分，随 Chrona 版本更新，只能查看。"),
      h("ul", { class: "plain" }, system.map(app => h("li", {}, h("a", { href: `/apps/system/${app.name}` }, app.name), " ", h("span", { class: "muted" }, app.description))))) : "");
}
async function systemApp(name, opened) {
  const meta = await web(`/system-apps?module=${encodeURIComponent(name)}`);
  let recent = [];
  try { recent = (await web(`/activity?module=${encodeURIComponent(name)}`)).items; } catch { /* the rest still shows */ }
  const who = tool => tool.callers ? `仅 ${tool.callers.join("、")}` : tool.visibility.includes("provider") ? "Chrona" : "声明了它的应用";
  main.replaceChildren(
    h("section", {}, h("h2", {}, `${meta.name} · 系统`), h("p", {}, meta.description), h("p", { class: "muted" }, "Chrona 自身的一部分：不能构建、更新或停用，随 Chrona 版本更新。")),
    meta.sessions ? h("section", {}, h("h2", {}, "最近的工作"),
      meta.work.length ? h("ul", { class: "plain" }, meta.work.map(session => h("li", { id: `session-${session.id}` }, when(session.createdAt), " · ", session.status === "active" ? "进行中" : "已结束", " ", transcript(session.id, session.id === opened))))
        : h("p", { class: "muted" }, "还没有工作记录。")) : "",
    recent.length ? h("section", {}, h("h2", {}, "活动"), h("ul", { class: "plain" }, recent.slice(0, 10).map(activityItem)),
      h("p", {}, h("a", { href: `/activity?module=${encodeURIComponent(name)}` }, "查看全部活动"))) : "",
    name === "memory" ? await memoryPanel() : "",
    h("section", {}, h("h2", {}, "提供的工具"), h("ul", { class: "plain" }, meta.tools.map(tool => h("li", {}, h("code", {}, `${meta.name}.${tool.name}`), " ", h("span", { class: "muted" }, `${who(tool)}可调用 · ${tool.description}`))))));
}
// v2-21: what memory is doing, and the user's own search with deletion.
async function memoryPanel() {
  let state = null;
  try { state = await web("/memory"); } catch { /* the search still works or shows its error */ }
  const results = h("ul", { class: "plain" }), note = h("p", { class: "muted", role: "status" });
  const search = async event => {
    event.preventDefault();
    note.textContent = "检索中……"; results.replaceChildren();
    try {
      const { items } = await web(`/memory?query=${encodeURIComponent(event.target.elements.query.value)}`);
      note.textContent = items.length ? "" : "没有找到。只用全文检索时请换关键词试试。";
      results.append(...items.map(item => h("li", {}, item.content, " ", h("span", { class: "muted" }, item.at ? when(item.at) : ""), " ", h("button", { type: "button", onclick: async click => {
        if (!confirm("删除这条记忆？")) return;
        try { await web("/memory/forget", { method: "POST", body: { id: item.id } }); click.target.closest("li").remove(); } catch (error) { note.textContent = error.message; }
      } }, "删除"))));
    } catch (error) { note.textContent = error.message; }
  };
  return h("section", {}, h("h2", {}, "记忆"),
    h("p", { class: "muted" }, state ? `${state.provider ? `提供者 ${state.provider}${state.available ? "" : "（不可用）"}` : "未启用"} · 自动检索${state.autoRecall ? "开" : "关"} · 自动写入${state.autoRetain ? "开" : "关"} · 24 小时内写入 ${state.last24h.retained}、检索 ${state.last24h.recalled}、删除 ${state.last24h.forgotten}` : "状态读取失败"),
    h("form", { onsubmit: search }, h("div", { class: "row" }, h("input", { name: "query", required: true, placeholder: "关键词" }), h("button", { class: "primary" }, "检索"))), note, results);
}
// A line about a conversation links to its process: a build has its own page, other work opens in its system app.
function processLink(item) {
  if (!item.session) return null;
  const href = item.session.source === "build" ? `/sessions/${item.session.id}` : `/apps/system/${encodeURIComponent(item.module)}?session=${encodeURIComponent(item.session.id)}`;
  return h("span", {}, " · ", h("a", { href }, "查看过程"));
}
function activityItem(item) {
  return h("li", {}, h("span", { class: "muted" }, when(item.at)), " ", item.text, processLink(item));
}
// The generic app page: what Chrona recorded (versions, runs) and the tools the app offers the user.
async function app(appId) {
  const meta = (await web("/modules")).find(a => a.id === appId);
  if (!meta) throw new Error("没有这个应用");
  const tools = (await web(`/tools?query=${encodeURIComponent(meta.name)}`)).filter(tool => tool.target.startsWith(`${meta.name}.`));
  main.replaceChildren(
    h("section", {}, h("h2", {}, meta.name), h("p", { class: "muted" }, `配置：${meta.status === "active" ? "已启用" : "已暂停"} · ${runtimeText(meta)}${meta.description ? ` · ${meta.description}` : ""}`),
      await currentVersion(meta),
      meta.name === "files" ? h("p", {}, h("a", { href: "/files" }, "打开文档")) : ""),
    diagnosticPanel(meta),
    await permissionsPanel(meta),
    tools.length ? h("section", {}, h("h2", {}, "操作"), ...tools.map(toolForm)) : "",
    h("section", {}, h("h2", {}, "最近运行"),
      meta.runs.length ? h("ul", { class: "plain" }, meta.runs.map(run => h("li", {}, when(run.createdAt), " · ", run.triggerId, " · ",
        run.error ? h("span", { class: "error" }, run.error) : run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`))) : h("p", { class: "muted" }, "还没有运行记录。")),
    h("section", {}, h("h2", {}, "版本"),
      h("ul", { class: "plain" }, meta.versions.slice(0, 5).map(version => h("li", {}, when(version.createdAt), " · ", version.hash.slice(0, 8), " · ", version.hash === meta.activeHash ? "当前" : version.status,
        version.errors ? h("div", { class: "error" }, version.errors.join("；")) : "")))));
}
// v2-18: which version runs, since when and how it got there, from the activity trail.
async function currentVersion(meta) {
  let recent = [];
  try { recent = (await web(`/activity?module=${encodeURIComponent(meta.name)}`)).items; } catch { /* the version line still shows */ }
  const switched = recent.find(item => ["module_activate", "module_auto_activated", "module_rollback", "admin_rollback"].includes(item.kind));
  return h("div", {},
    h("p", {}, h("strong", {}, `当前版本 ${String(meta.activeHash ?? "无").slice(0, 8)}`), switched ? h("span", { class: "muted" }, ` · ${when(switched.at)} · ${switched.text}`) : null),
    recent.length > 1 ? h("ul", { class: "plain" }, recent.filter(item => item !== switched).slice(0, 5).map(item => h("li", {}, h("span", { class: "muted" }, when(item.at)), " ", item.text))) : null,
    h("p", {}, h("a", { href: `/activity?module=${encodeURIComponent(meta.name)}` }, "查看全部活动")));
}
// ---------------------------------------------------------------- activity --
async function activity(params) {
  const module = params.get("module") ?? "", items = h("ul", { class: "plain" }), more = h("button", { type: "button", hidden: true }, "更早的");
  let before = null;
  const load = async () => {
    const query = new URLSearchParams({ ...(module ? { module } : {}), ...(before ? { before } : {}) });
    const page = await web(`/activity?${query}`);
    items.append(...page.items.map(item => h("li", {}, h("span", { class: "muted" }, when(item.at)), " ", item.module && !module ? h("a", { href: `/activity?module=${encodeURIComponent(item.module)}` }, item.module) : null, item.module && !module ? " · " : null, item.text,
      processLink(item))));
    before = page.before; more.hidden = !before;
    if (!items.children.length) items.replaceWith(h("p", { class: "muted" }, "还没有活动。"));
  };
  more.addEventListener("click", () => load().catch(error => alert(error.message)));
  main.replaceChildren(h("section", {}, h("h2", {}, module ? `活动 · ${module}` : "活动"),
    h("p", { class: "muted" }, "Chrona 做过的事：审批与你的决定、AI 复核、应用的检查、启用、自动更新、回滚和故障、授权、设置与凭据的改动（只记名称）。"),
    module ? h("p", {}, h("a", { href: "/activity" }, "看全部应用")) : null, items, more));
  await load();
}
// v2-17: one app's permissions and use in one place; each is still changed where it lives (settings, grants).
async function permissionsPanel(meta) {
  let view;
  try { view = await web(`/modules/${meta.id}/permissions`); } catch (error) { return h("section", {}, h("h2", {}, "权限与用量"), h("p", { class: "error" }, error.message)); }
  const revoke = grant => async () => {
    if (!confirm("撤销这条授权？")) return;
    try { await web(`/grants/${grant.id}/revoke`, { method: "POST" }); app(meta.id); } catch (error) { alert(error.message); }
  };
  const model = view.model;
  return h("section", {}, h("h2", {}, "权限与用量"),
    h("h3", {}, "能做什么"), view.capabilities.length ? h("ul", { class: "plain" }, view.capabilities.map(item => h("li", {}, item))) : h("p", { class: "muted" }, "只在自己的数据里工作，不联网、不调用其他应用。"),
    view.secrets.length ? [h("h3", {}, "凭据"), h("ul", { class: "plain" }, view.secrets.map(secret => h("li", {}, secret.name, " ", h("span", { class: secret.configured ? "muted" : "error" }, secret.configured ? `已设置${secret.updatedAt ? ` · ${when(secret.updatedAt)}` : ""}` : "未设置"), " ", h("a", { href: "/settings" }, "去设置"))))] : null,
    model ? [h("h3", {}, "模型"), h("p", {}, `档位 ${model.tier}${model.target ? `（${model.target.model}${model.target.thinking ? ` · ${model.target.thinking}` : ""}）` : "（未配置）"} · 今天 ${model.today.calls} 次${model.dailyCap !== null ? ` / 上限 ${model.dailyCap}` : ""} · 输入 ${model.today.inputTokens} / 输出 ${model.today.outputTokens} token `, h("a", { href: "/settings" }, "调整"))] : null,
    h("h3", {}, "你给过的授权"), view.grants.length ? h("ul", { class: "plain" }, view.grants.map(grant => h("li", {}, `${grant.action} · ${grant.mode}${grant.once ? " · 一次" : ""}`, " ", h("button", { onclick: revoke(grant) }, "撤销")))) : h("p", { class: "muted" }, "没有。"),
    h("h3", {}, "最近审批"), view.approvals.length ? h("ul", { class: "plain" }, view.approvals.map(item => h("li", {}, h("span", { class: `level ${item.level}` }, LEVELS[item.level] ?? item.level), " ", item.title, " ", h("span", { class: "muted" }, `${STATUS[item.status] ?? item.status} · ${when(item.createdAt)}`)))) : h("p", { class: "muted" }, "没有。"));
}
const STATUS = { open: "待决定", approved: "已批准", denied: "已拒绝", expired: "已过期" };
function toolForm(tool) {
  const properties = Object.entries(tool.inputSchema.properties ?? {}), required = tool.inputSchema.required ?? [];
  const output = h("pre", { hidden: true });
  const field = ([name, schema]) => h("label", {}, `${name}${required.includes(name) ? " *" : ""} `,
    schema.enum ? h("select", { name }, (required.includes(name) ? [] : [h("option", { value: "" }, "")]).concat(schema.enum.map(value => h("option", { value }, value))))
      : h("input", { name, type: schema.type === "boolean" ? "checkbox" : schema.type === "number" ? "number" : "text", required: schema.type !== "boolean" && required.includes(name), style: schema.type === "boolean" ? "width:auto" : false, title: schema.description ?? false }));
  return h("form", { onsubmit: async event => {
    event.preventDefault();
    // A tool that is not idempotent may change things: ask first.
    if (!tool.idempotent && !confirm(`执行 ${tool.target}？`)) return;
    const args = {};
    for (const [name, schema] of properties) {
      const input = event.target.elements[name];
      if (schema.type === "boolean") args[name] = input.checked;
      else if (input.value !== "") args[name] = schema.type === "number" ? Number(input.value) : input.value;
    }
    output.hidden = false; output.textContent = "执行中……";
    try { output.textContent = JSON.stringify(await web("/call", { method: "POST", body: { target: tool.target, args } }), null, 2); }
    catch (error) { output.textContent = error.message; }
  } }, h("div", {}, h("strong", {}, tool.target.split(".")[1]), " ", h("span", { class: "muted" }, tool.description)),
    ...properties.map(field), h("div", { class: "row" }, h("button", { class: "primary" }, "执行")), output);
}
// ------------------------------------------------------------------ files --
// The user's documents: a page over the files app's tools (list, read, write).
async function files(params) {
  const file = params.get("file"), dir = file ? file.split("/").slice(0, -1).join("/") : params.get("dir") ?? "";
  const listing = await tool("files.list", dir ? { dir } : {});
  const up = dir ? dir.split("/").slice(0, -1).join("/") : null, join = name => dir ? `${dir}/${name}` : name;
  const entries = [...listing.entries].filter(entry => entry.name !== ".trash").sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  const view = h("section", {});
  main.replaceChildren(h("div", { class: "chat" },
    h("section", {}, h("h2", {}, dir ? dir : "文档"),
      h("ul", { class: "plain" }, up !== null ? h("li", {}, h("a", { href: up ? `/files?dir=${encodeURIComponent(up)}` : "/files" }, "← 上一级")) : "",
        entries.map(entry => h("li", { class: join(entry.name) === file ? "selected" : "" },
          h("a", { href: entry.kind === "directory" ? `/files?dir=${encodeURIComponent(join(entry.name))}` : `/files?file=${encodeURIComponent(join(entry.name))}` }, entry.kind === "directory" ? `${entry.name}/` : entry.name)))),
      listing.truncated ? h("p", { class: "muted" }, "列表过长，只显示了一部分。") : ""),
    view));
  if (file) await document_(file, view);
}
async function document_(path, view) {
  const file = await tool("files.read", { path });
  if (file.content === undefined) { view.replaceChildren(h("h2", {}, path), h("p", { class: "muted" }, `不是文本文件（${file.mime}，${file.size} 字节）。`)); return; }
  const reload = () => document_(path, view), status = h("span", { class: "muted" });
  const save = async content => {
    try { await tool("files.write", { path, content }); status.textContent = "已保存"; await reload(); }
    catch (error) { status.textContent = error.message; }
  };
  // Ticking a box rewrites that one line; truncated documents are read-only here.
  const toggle = async (line, checked) => {
    const lines = file.content.split("\n");
    lines[line - 1] = lines[line - 1].replace(/\[( |x|X)\]/, checked ? "[x]" : "[ ]");
    await save(lines.join("\n"));
  };
  const editor = h("textarea", { class: "editor" }, file.content);
  const rendered = /\.md$/i.test(path) ? markdown(file, file.truncated ? () => reload() : toggle) : h("pre", {}, file.content);
  view.replaceChildren(h("h2", {}, path), file.truncated ? h("p", { class: "muted" }, "文档过长，只显示了开头，不能在这里修改。") : "", rendered,
    file.truncated ? "" : h("details", {}, h("summary", {}, "编辑"), editor, h("div", { class: "row" }, h("button", { class: "primary", onclick: () => save(editor.value) }, "保存"), status)));
}

// --------------------------------------------------------------- settings --
async function settings() {
  const view = await web("/settings"), reload = () => settings();
  const act = (path, body, ask) => async () => {
    if (ask && !confirm(ask)) return;
    try { await web(path, { method: "POST", ...(body ? { body } : {}) }); reload(); } catch (error) { alert(error.message); }
  };
  const n = view.settings.notifications, status = h("span", { class: "muted" });
  const field = (label, input) => h("label", {}, `${label} `, input);
  const form = h("form", { onsubmit: async event => {
    event.preventDefault();
    const f = event.target.elements, quiet = f.quietStart.value && f.quietEnd.value ? { start: f.quietStart.value, end: f.quietEnd.value } : null;
    try { const saved = await web("/settings", { method: "POST", body: { notifications: { dailyCap: Number(f.dailyCap.value), quietHours: quiet, timezone: f.timezone.value, digestAt: f.digestAt.value } } }); showBuildUsage(saved); status.textContent = "已保存"; }
    catch (error) { status.textContent = error.message; }
  } },
    field("每天最多主动通知", h("input", { name: "dailyCap", type: "number", min: 0, max: 50, value: n.dailyCap })),
    field("安静时段", h("span", {}, h("input", { name: "quietStart", type: "time", value: n.quietHours?.start ?? "" }), " – ", h("input", { name: "quietEnd", type: "time", value: n.quietHours?.end ?? "" }))),
    field("时区", h("input", { name: "timezone", value: n.timezone })),
    field("汇总时间", h("input", { name: "digestAt", type: "time", value: n.digestAt })),
    h("div", { class: "row" }, h("button", { class: "primary" }, "保存"), status));
  const builds = view.settings.builds, buildStatus = h("span", { class: "muted", role: "status" }), usage = h("p", { class: "muted" });
  const showBuildUsage = settings => {
    const u = settings.buildUsage;
    usage.textContent = `${u.date}（${u.timezone}）：今日新建 ${u.used} / ${settings.builds.dailyLimit}，剩余 ${u.remaining} 个。`;
  };
  showBuildUsage(view.settings);
  let savingBuilds = false;
  const buildForm = h("form", { onsubmit: async event => {
    event.preventDefault();
    if (savingBuilds) return;
    const f = event.target.elements, button = event.target.querySelector("button[type=submit]");
    savingBuilds = true; button.disabled = true; buildStatus.textContent = "正在保存……";
    try {
      const saved = await web("/settings", { method: "POST", body: { builds: { dailyLimit: Number(f.buildDailyLimit.value), timeoutMinutes: Number(f.buildTimeoutMinutes.value), maxSubmissions: Number(f.buildMaxSubmissions.value) }, reflection: { enabled: f.reflection.checked } } });
      showBuildUsage(saved); buildStatus.textContent = "已保存，下次构建生效；当前构建不受影响。";
    } catch (error) { buildStatus.textContent = error.message; }
    finally { savingBuilds = false; button.disabled = false; }
  } },
    field("每日新建构建上限", h("input", { name: "buildDailyLimit", type: "number", min: 0, max: 200, step: 1, required: true, value: builds.dailyLimit })),
    field("单轮构建时限（分钟）", h("input", { name: "buildTimeoutMinutes", type: "number", min: 5, max: 120, step: 1, required: true, value: builds.timeoutMinutes })),
    field("每轮候选提交上限", h("input", { name: "buildMaxSubmissions", type: "number", min: 1, max: 20, step: 1, required: true, value: builds.maxSubmissions })),
    // Reflection (v2-19): Chrona starts builds on its own; what they produce is still levelled and reviewed.
    field("主动反思", h("label", { class: "muted" }, h("input", { name: "reflection", type: "checkbox", checked: view.settings.reflection?.enabled !== false, style: "width:auto" }), " 应用上线或出错后，Chrona 自己判断是否需要改进并开始构建（低风险结果自动上线，其余请你批准）")),
    h("div", { class: "row" }, h("button", { type: "submit", class: "primary" }, "保存构建设置"), buildStatus));
  // Module models (v2-17): tiers (model + thinking level), call limits, per-module daily caps and today's use.
  const models = modelForm(view.settings, reload);
  // Memory (v2-21): which app provides it; the built-in one downloads its packages only when chosen.
  const memory = view.settings.memory ?? { provider: null, autoRecall: true, autoRetain: true }, memoryStatus = h("span", { class: "muted", role: "status" });
  const memoryForm = h("form", { onsubmit: async event => {
    event.preventDefault();
    const f = event.target.elements, provider = f.memoryProvider.value === "other" ? f.memoryOther.value.trim() : f.memoryProvider.value;
    memoryStatus.textContent = "正在保存……";
    try { await web("/settings", { method: "POST", body: { memory: { provider: provider || null, autoRecall: f.autoRecall.checked, autoRetain: f.autoRetain.checked } } }); memoryStatus.textContent = "已保存。"; }
    catch (error) { memoryStatus.textContent = error.message; }
  } },
    field("记忆提供者", h("select", { name: "memoryProvider" },
      h("option", { value: "", selected: !memory.provider }, "不启用"),
      h("option", { value: "memory-local", selected: memory.provider === "memory-local" }, "内置（memory-local，启用时下载约 262 MB）"),
      h("option", { value: "other", selected: !!memory.provider && memory.provider !== "memory-local" }, "其他应用（适配模块）"))),
    field("其他应用名", h("input", { name: "memoryOther", value: memory.provider && memory.provider !== "memory-local" ? memory.provider : "", placeholder: "如 memory-hindsight" })),
    field("对话开始时自动检索", h("input", { name: "autoRecall", type: "checkbox", checked: memory.autoRecall, style: "width:auto" })),
    field("每 4 条消息自动写入", h("input", { name: "autoRetain", type: "checkbox", checked: memory.autoRetain, style: "width:auto" })),
    h("div", { class: "row" }, h("button", { type: "submit", class: "primary" }, "保存记忆设置"), memoryStatus));
  // Credentials (v2-16): field name + value pairs; saved values are never shown, only whether one is set.
  const secretForm = secret => {
    const rows = h("div", {}), state = h("span", { class: "muted", role: "status" });
    const addRow = () => rows.append(h("div", { class: "row" }, h("input", { name: "field", placeholder: "字段名，如 apiKey", autocomplete: "off" }), h("input", { name: "value", type: "password", placeholder: "值", autocomplete: "new-password" })));
    for (let i = 0; i < 3; i++) addRow();
    return h("form", { onsubmit: async event => {
      event.preventDefault();
      const value = Object.fromEntries([...rows.children].map(row => [row.querySelector("[name=field]").value.trim(), row.querySelector("[name=value]").value]).filter(([field, text]) => field && text));
      if (!Object.keys(value).length) { state.textContent = "至少填写一个字段"; return; }
      try { await web(`/secrets/${secret.name}`, { method: "POST", body: { value } }); reload(); } catch (error) { state.textContent = error.message; }
    } }, rows, h("div", { class: "row" }, h("button", { type: "button", onclick: addRow }, "加一个字段"), h("button", { type: "submit", class: "primary" }, secret.configured ? "替换" : "保存"), state));
  };
  const secrets = h("section", {}, h("h2", {}, "凭据"),
    h("p", { class: "muted" }, "应用需要的账号密钥。只保存在 Chrona 本机，不会显示、不进入对话或模型；替换会覆盖整份凭据。"),
    view.secrets?.length ? h("ul", { class: "plain" }, view.secrets.map(secret => h("li", {},
      h("strong", {}, secret.name), " ", h("span", { class: "muted" }, `${secret.configured ? `已设置 · ${when(secret.updatedAt)}` : "未设置"}${secret.modules.length ? ` · 用于 ${secret.modules.join("、")}` : ""}`), " ",
      secret.configured && h("button", { onclick: act(`/secrets/${secret.name}/remove`, null, `删除凭据 ${secret.name}？`) }, "删除"),
      secretForm(secret)))) : h("p", { class: "muted" }, "没有应用需要凭据。"));
  const activeGrants = view.grants.filter(g => !g.revokedAt && !(g.once && g.consumedAt) && !(g.expiresAt && Date.parse(g.expiresAt) <= Date.now()));
  const live = view.schedules.filter(s => s.status === "active" || s.status === "paused");
  main.replaceChildren(
    h("section", {}, h("h2", {}, "设置"), form),
    h("section", {}, h("h2", {}, "构建设置"), usage,
      h("p", { class: "muted" }, "每日额度按上方时区的零点重置，只计算新建构建会话；手动续作仍受每会话每日24次、全局每日200次运行限制。设为0可暂停新建。"),
      h("p", { class: "muted" }, "修改只影响后续构建，不中断当前构建。失败不自动重试，启用应用仍需遵循审批。提高额度可能增加模型费用。"), buildForm),
    models,
    h("section", {}, h("h2", {}, "记忆"), h("p", { class: "muted" }, "对话内容会写入你选的记忆系统；检索到的记忆只作参考数据。外部系统由 Chrona 构建适配应用接入。"), memoryForm),
    secrets,
    h("section", {}, h("h2", {}, "日程"),
      live.length ? h("ul", { class: "plain" }, live.map(s => h("li", {}, s.label ?? s.mode, " ", h("span", { class: "muted" }, s.status === "paused" ? "已暂停" : s.nextAt ? when(s.nextAt) : ""), " ",
        s.status === "active" ? h("button", { onclick: act(`/schedules/${s.id}`, { status: "paused" }) }, "暂停") : h("button", { onclick: act(`/schedules/${s.id}`, { status: "active" }) }, "恢复"),
        h("button", { onclick: act(`/schedules/${s.id}`, { status: "cancelled" }, "取消这个日程？") }, "取消")))) : h("p", { class: "muted" }, "没有日程。")),
    h("section", {}, h("h2", {}, "授权规则"),
      activeGrants.length ? h("ul", { class: "plain" }, activeGrants.map(g => h("li", {}, `${g.action} · ${g.mode}`, " ", h("span", { class: "muted" }, g.scope.kind === "module" ? "仅一个应用" : "全部"), " ",
        h("button", { onclick: act(`/grants/${g.id}/revoke`, null, "撤销这条授权？") }, "撤销")))) : h("p", { class: "muted" }, "没有授权规则。")),
    h("section", {}, h("h2", {}, "Chrona 记得的偏好"),
      view.preferences.length ? h("ul", { class: "plain" }, view.preferences.map(p => h("li", {}, p.text, " ", h("button", { onclick: act(`/preferences/${p.id}/forget`, null, "删除这条偏好？") }, "删除")))) : h("p", { class: "muted" }, "还没有。")));
}

const THINKING = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
function modelForm(settings, reload) {
  const current = settings.moduleModel, state = h("span", { class: "muted", role: "status" });
  const tiers = h("div", {}), caps = h("div", {});
  const tierRow = (name = "", target = "") => {
    const { model = "", thinking = "" } = typeof target === "string" ? { model: target } : target;
    tiers.append(h("div", { class: "fields" }, h("input", { name: "tier", placeholder: "档位，如 strong", value: name, autocomplete: "off" }), h("input", { name: "model", placeholder: "模型，如 openai/gpt-6.1-sol", value: model, autocomplete: "off" }),
      h("select", { name: "thinking", "aria-label": "思考等级" }, THINKING.map(level => h("option", { value: level, ...(level === thinking ? { selected: true } : {}) }, level || "默认思考")))));
  };
  const capRow = (module = "", calls = "") => caps.append(h("div", { class: "fields pair" }, h("input", { name: "capModule", placeholder: "模块名", value: module, autocomplete: "off" }), h("input", { name: "capCalls", type: "number", min: 0, max: 10000, value: calls, "aria-label": "每日上限" })));
  for (const [name, target] of Object.entries(current?.models ?? { strong: "" })) tierRow(name, target);
  for (const [module, calls] of Object.entries(current?.moduleDailyCalls ?? {})) capRow(module, calls);
  const number = (name, label, value, min, max) => h("label", {}, `${label} `, h("input", { name, type: "number", min, max, step: 1, required: true, value: value ?? "" }));
  const read = f => {
    const value = row => row.querySelector.bind(row);
    const models = Object.fromEntries([...tiers.children].map(row => [value(row)("[name=tier]").value.trim(), value(row)("[name=model]").value.trim(), value(row)("[name=thinking]").value])
      .filter(([tier, model]) => tier && model).map(([tier, model, thinking]) => [tier, thinking ? { model, thinking } : { model }]));
    const moduleDailyCalls = Object.fromEntries([...caps.children].map(row => [value(row)("[name=capModule]").value.trim(), value(row)("[name=capCalls]").value]).filter(([module, calls]) => module && calls !== "").map(([module, calls]) => [module, Number(calls)]));
    const review = f.reviewTier.value.trim() ? { review: { tier: f.reviewTier.value.trim(), dailyCalls: Number(f.reviewDailyCalls.value) } } : {};
    return { models, maxCallsPerEvent: Number(f.maxCallsPerEvent.value), maxOutputTokens: Number(f.maxOutputTokens.value), dailyCalls: Number(f.dailyCalls.value), timeoutMs: Number(f.timeoutSeconds.value) * 1000, ...(Object.keys(moduleDailyCalls).length ? { moduleDailyCalls } : {}), ...review };
  };
  const save = async moduleModel => {
    try { await web("/settings", { method: "POST", body: { moduleModel } }); state.textContent = "已保存"; reload(); } catch (error) { state.textContent = error.message; }
  };
  const form = h("form", { onsubmit: event => {
    event.preventDefault();
    const moduleModel = read(event.target.elements);
    if (!Object.keys(moduleModel.models).length) { state.textContent = "至少配置一个档位"; return; }
    save(moduleModel);
  } },
    h("p", { class: "muted" }, "模块在清单里只写档位名；这里决定每个档位用哪个模型、思考多深。"), tiers,
    h("div", { class: "row" }, h("button", { type: "button", onclick: () => tierRow() }, "加一个档位")),
    h("div", { class: "row" }, number("maxCallsPerEvent", "每次事件最多调用", current?.maxCallsPerEvent ?? 3, 1, 20), number("maxOutputTokens", "单次最多输出 token", current?.maxOutputTokens ?? 4000, 1, 32000),
      number("dailyCalls", "全部模块每天合计", current?.dailyCalls ?? 30, 1, 10000), number("timeoutSeconds", "超时（秒）", (current?.timeoutMs ?? 180000) / 1000, 5, 600)),
    h("p", { class: "muted" }, "单个模块的每日上限（未列出的只受合计限制；超出只停这个模块）："), caps,
    h("div", { class: "row" }, h("button", { type: "button", onclick: () => capRow() }, "加一个模块上限")),
    h("p", { class: "muted" }, "审批复核：新审批先由这个档位独立看一遍，只能提高风险等级，不能替你批准；额度用完时改为直接问你。"),
    h("div", { class: "row" }, h("label", {}, "复核档位 ", h("input", { name: "reviewTier", placeholder: "默认 strong", value: current?.review?.tier ?? "", autocomplete: "off" })),
      number("reviewDailyCalls", "复核每天最多", current?.review?.dailyCalls ?? 30, 0, 1000)),
    h("div", { class: "row" }, h("button", { type: "submit", class: "primary" }, "保存模块模型"), current && h("button", { type: "button", onclick: () => { if (confirm("关闭后模块都不能调用模型，确定？")) save(null); } }, "关闭模块模型"), state));
  const usage = settings.modelUsage ?? [];
  return h("section", {}, h("h2", {}, "模块模型"), current ? null : h("p", { class: "muted" }, "尚未配置：模块不能调用模型。"), form,
    h("h3", {}, "今日用量"), usage.length ? h("ul", { class: "plain" }, usage.map(row => h("li", {}, `${row.module}：${row.calls} 次`, " ", h("span", { class: "muted" }, `输入 ${row.inputTokens} / 输出 ${row.outputTokens} token${current?.moduleDailyCalls?.[row.module] !== undefined ? ` · 上限 ${current.moduleDailyCalls[row.module]}` : ""}`)))) : h("p", { class: "muted" }, "今天还没有模块调用模型。"));
}

// ----------------------------------------------------------------- router --
async function route() {
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  replyListeners.clear();
  try {
    if (parts[0] === "chat") await chat(null);
    else if (parts[0] === "sessions" && parts[1]) await chat(parts[1]);
    else if (parts[0] === "files") await files(url.searchParams);
    else if (parts[0] === "settings") await settings();
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemApp(decodeURIComponent(parts[2]), url.searchParams.get("session"));
    else if (parts[0] === "apps" && parts[1]) await app(parts[1]);
    else if (parts[0] === "apps") await apps();
    else if (parts[0] === "activity") await activity(url.searchParams);
    else await today();
  } catch (error) {
    if (error instanceof Unauthorized) login(localStorage.getItem(KEY) ? "密钥不正确，请重新输入。" : undefined);
    else main.replaceChildren(h("section", {}, h("p", { class: "error" }, error.message)));
  }
}
function go(path, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  void route();
}
document.addEventListener("click", event => {
  const link = event.target.closest("a[href^='/']");
  if (!link || link.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault(); go(link.getAttribute("href"));
});
addEventListener("popstate", () => void route());
document.getElementById("logout").addEventListener("click", () => { localStorage.removeItem(KEY); login(); });

let listening = false;
async function start() {
  document.getElementById("logout").hidden = !localStorage.getItem(KEY);
  // Stops on a wrong key; the next start (after login) listens again.
  if (!listening) { listening = true; void listen().finally(() => { listening = false; }); }
  await route();
}
void start();
