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
function approvalItem(approval, after) {
  const decide = (decision, scope = "once") => async () => {
    try { await web(`/approvals/${approval.id}/resolve`, { method: "POST", body: { decision, scope } }); after(); }
    catch (error) { alert(error.message); }
  };
  return h("li", {},
    h("div", {}, h("strong", {}, approval.title), " ", h("span", { class: "muted" }, when(approval.createdAt))),
    approval.detail && h("div", {}, approval.detail),
    approval.preview && h("details", {}, h("summary", {}, "详情"), h("pre", {}, approval.preview)),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: decide("approve") }, "批准"),
      approval.moduleId && h("button", { onclick: decide("approve", "always") }, "始终允许"), h("button", { onclick: decide("deny") }, "拒绝")));
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
    event.target.text.value = ""; status.textContent = "Chrona 正在处理……";
    list.append(h("div", { class: "bubble in" }, text));
    try {
      const sent = await web("/chat", { method: "POST", body: current ? { text, session: current } : { text } });
      // A new conversation: open it; its replies arrive on the reopened page.
      if (!current) go(`/sessions/${sent.sessionId}`, true);
    } catch (error) { status.textContent = error.message; }
  } }, h("textarea", { name: "text", rows: 3, placeholder: current ? "说点什么……（Ctrl+Enter 发送）" : "新会话：说点什么……", onkeydown: event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.target.form.requestSubmit(); } }),
    h("div", { class: "row" }, h("button", { class: "primary" }, "发送"), status));
  main.replaceChildren(h("div", { class: "chat" },
    h("section", {}, h("h2", {}, "会话"),
      h("button", { onclick: () => go("/chat/new") }, "新会话"),
      h("ul", { class: "plain" }, sessions.map(s => h("li", { class: s.id === current ? "selected" : "" }, h("a", { href: `/sessions/${s.id}` }, s.title ?? when(s.createdAt)))))),
    h("section", {}, list, building ? h("p", { class: "muted" }, "这是 Chrona 自己的构建对话，不接收消息；结果会发回发起它的对话。") : form, current ? transcript(current, building) : "")));
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
async function apps() {
  const items = await web("/modules");
  main.replaceChildren(h("section", {}, h("h2", {}, "应用"),
    h("ul", { class: "plain" }, items.map(app => h("li", {}, h("a", { href: `/apps/${app.id}` }, app.name), " ",
      h("span", { class: "muted" }, `${app.status === "active" ? "" : "已暂停 · "}${app.builtin ? "内置 · " : ""}${app.description ?? ""}`))))));
}
// The generic app page: what Chrona recorded (versions, runs) and the tools the app offers the user.
async function app(appId) {
  const meta = (await web("/modules")).find(a => a.id === appId);
  if (!meta) throw new Error("没有这个应用");
  const tools = (await web(`/tools?query=${encodeURIComponent(meta.name)}`)).filter(tool => tool.target.startsWith(`${meta.name}.`));
  main.replaceChildren(
    h("section", {}, h("h2", {}, meta.name), h("p", { class: "muted" }, `${meta.status === "active" ? "运行中" : "已暂停"}${meta.description ? ` · ${meta.description}` : ""}`),
      meta.name === "files" ? h("p", {}, h("a", { href: "/files" }, "打开文档")) : ""),
    tools.length ? h("section", {}, h("h2", {}, "操作"), ...tools.map(toolForm)) : "",
    h("section", {}, h("h2", {}, "最近运行"),
      meta.runs.length ? h("ul", { class: "plain" }, meta.runs.map(run => h("li", {}, when(run.createdAt), " · ", run.triggerId, " · ",
        run.error ? h("span", { class: "error" }, run.error) : run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`))) : h("p", { class: "muted" }, "还没有运行记录。")),
    h("section", {}, h("h2", {}, "版本"),
      h("ul", { class: "plain" }, meta.versions.slice(0, 5).map(version => h("li", {}, when(version.createdAt), " · ", version.hash.slice(0, 8), " · ", version.hash === meta.activeHash ? "当前" : version.status,
        version.errors ? h("div", { class: "error" }, version.errors.join("；")) : "")))));
}
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
    let moduleModel;
    try { moduleModel = f.moduleModel.value.trim() ? JSON.parse(f.moduleModel.value) : null; } catch { status.textContent = "模块模型不是有效的 JSON"; return; }
    try { await web("/settings", { method: "POST", body: { notifications: { dailyCap: Number(f.dailyCap.value), quietHours: quiet, timezone: f.timezone.value, digestAt: f.digestAt.value }, moduleModel } }); status.textContent = "已保存"; }
    catch (error) { status.textContent = error.message; }
  } },
    field("每天最多主动通知", h("input", { name: "dailyCap", type: "number", min: 0, max: 50, value: n.dailyCap })),
    field("安静时段", h("span", {}, h("input", { name: "quietStart", type: "time", value: n.quietHours?.start ?? "" }), " – ", h("input", { name: "quietEnd", type: "time", value: n.quietHours?.end ?? "" }))),
    field("时区", h("input", { name: "timezone", value: n.timezone })),
    field("汇总时间", h("input", { name: "digestAt", type: "time", value: n.digestAt })),
    field("模块模型（JSON，空为不允许模块调用模型）", h("textarea", { name: "moduleModel", rows: 6 }, view.settings.moduleModel ? JSON.stringify(view.settings.moduleModel, null, 2) : "")),
    h("div", { class: "row" }, h("button", { class: "primary" }, "保存"), status));
  const activeGrants = view.grants.filter(g => !g.revokedAt && !(g.once && g.consumedAt) && !(g.expiresAt && Date.parse(g.expiresAt) <= Date.now()));
  const live = view.schedules.filter(s => s.status === "active" || s.status === "paused");
  main.replaceChildren(
    h("section", {}, h("h2", {}, "设置"), form),
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

// ----------------------------------------------------------------- router --
async function route() {
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  replyListeners.clear();
  try {
    if (parts[0] === "chat") await chat(null);
    else if (parts[0] === "sessions" && parts[1]) await chat(parts[1]);
    else if (parts[0] === "files") await files(url.searchParams);
    else if (parts[0] === "settings") await settings();
    else if (parts[0] === "apps" && parts[1]) await app(parts[1]);
    else if (parts[0] === "apps") await apps();
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
