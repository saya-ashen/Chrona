// Chrona's simple web page: plain DOM, no build step. Data comes from this module's /api/web (routed calls, v2-8);
// app content pages still read /api/steward until content areas go (v2-8 step 3). Both carry the user's key.
const KEY = "chrona.accessKey"; // the same key the previous web app stored
const main = document.getElementById("main");
let workspaceId = null;

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
// App content (until v2-8 step 3 removes content areas).
const steward = (path, options) => request(`/api/steward${path}${path.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}`, options);

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
async function today() {
  const view = await web("/today");
  main.replaceChildren(
    view.health && !view.health.provider.available ? h("section", {}, h("p", { class: "error" }, `Provider 不可用：${view.health.provider.lastError ?? view.health.provider.name}`)) : "",
    h("section", {}, h("h2", {}, `待你决定（${view.approvals.length}）`),
      view.approvals.length ? h("ul", { class: "plain" }, view.approvals.map(a => approvalItem(a, today))) : h("p", { class: "muted" }, "没有待处理的事项。")),
    h("section", {}, h("h2", {}, "接下来"),
      view.upcoming.length ? h("ul", { class: "plain" }, view.upcoming.map(item => h("li", {}, when(item.at), " · ", item.label ?? item.mode))) : h("p", { class: "muted" }, "七天内没有安排。")),
    h("section", {}, h("h2", {}, "最近通知"),
      view.updates.length ? h("ul", { class: "plain" }, view.updates.map(n => h("li", {}, h("strong", {}, n.title), " ", h("span", { class: "muted" }, when(n.createdAt)), h("div", {}, n.body)))) : h("p", { class: "muted" }, "暂无。")),
    h("section", {}, h("h2", {}, "应用"),
      h("ul", { class: "plain" }, view.apps.map(app => h("li", {}, h("a", { href: `/apps/${app.id}` }, app.name), " ", h("span", { class: "muted" }, app.status === "active" ? app.description ?? "" : "已暂停"))))),
    h("section", {}, h("h2", {}, "最近会话"),
      h("ul", { class: "plain" }, view.sessions.map(s => h("li", {}, h("a", { href: `/sessions/${s.id}` }, s.title ?? s.key), " ", h("span", { class: "muted" }, `${s.source} · ${when(s.lastActivityAt)}`))))),
  );
}

// ------------------------------------------------------------------- chat --
async function attachmentLink(file) {
  const [name, ...rest] = (file.ref ?? "").split("/");
  const app = file.appId ? { id: file.appId } : (await steward("/apps")).items.find(a => a.name === name);
  if (!app || !rest.length) return h("span", { class: "muted" }, file.name);
  return h("a", { href: `/apps/${app.id}?path=${encodeURIComponent(rest.join("/"))}` }, file.name);
}
async function bubble(message) {
  const node = h("div", { class: `bubble ${message.direction}` }, message.text);
  for (const file of message.attachments ?? []) node.append(h("div", {}, await attachmentLink(file)));
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
    h("section", {}, list, form)));
  list.scrollTop = list.scrollHeight;
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
async function app(appId, path) {
  const meta = (await web("/modules")).find(a => a.id === appId);
  if (!meta) throw new Error("没有这个应用");
  const tools = (await web(`/tools?query=${encodeURIComponent(meta.name)}`)).filter(tool => tool.target.startsWith(`${meta.name}.`));
  const content = (await steward("/apps")).items.find(a => a.id === appId);
  const files = h("section", {});
  main.replaceChildren(
    h("section", {}, h("h2", {}, meta.name), h("p", { class: "muted" }, `${meta.status === "active" ? "运行中" : "已暂停"}${meta.description ? ` · ${meta.description}` : ""}`)),
    tools.length ? h("section", {}, h("h2", {}, "操作"), ...tools.map(toolForm)) : "",
    h("section", {}, h("h2", {}, "最近运行"),
      meta.runs.length ? h("ul", { class: "plain" }, meta.runs.map(run => h("li", {}, when(run.createdAt), " · ", run.triggerId, " · ",
        run.error ? h("span", { class: "error" }, run.error) : run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`))) : h("p", { class: "muted" }, "还没有运行记录。")),
    h("section", {}, h("h2", {}, "版本"),
      h("ul", { class: "plain" }, meta.versions.slice(0, 5).map(version => h("li", {}, when(version.createdAt), " · ", version.hash.slice(0, 8), " · ", version.hash === meta.activeHash ? "当前" : version.status,
        version.errors ? h("div", { class: "error" }, version.errors.join("；")) : "")))),
    content?.content ? files : "");
  if (content?.content) await contentFiles(content, path, files);
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
async function contentFiles(meta, path, view) {
  const tree = (await steward(`/apps/${meta.id}/tree`)).items;
  const current = path ?? meta.entry ?? tree.find(node => node.kind === "file")?.path ?? null;
  const shown = h("div", {});
  view.replaceChildren(h("h2", {}, "内容"),
    h("details", { open: !current }, h("summary", {}, `文件（${tree.filter(n => n.kind === "file").length}）`),
      h("ul", { class: "plain" }, tree.filter(n => n.kind === "file").map(node => h("li", { class: node.path === current ? "selected" : "" },
        h("a", { href: `/apps/${meta.id}?path=${encodeURIComponent(node.path)}` }, node.path), " ", h("span", { class: "muted" }, when(node.updatedAt)))))), shown);
  if (current) await showFile(meta.id, current, shown);
}
async function showFile(appId, path, view) {
  let file;
  try { file = await steward(`/apps/${appId}/file?path=${encodeURIComponent(path)}`); }
  catch {
    // Binary files have no text view: offer the bytes through an authenticated download.
    const blob = await steward(`/apps/${appId}/raw?path=${encodeURIComponent(path)}`, { raw: true });
    const url = URL.createObjectURL(blob);
    view.replaceChildren(h("h3", {}, path), blob.type.startsWith("image/") ? h("img", { src: url, alt: path, style: "max-width:100%" }) : "", h("p", {}, h("a", { href: url, download: path.split("/").pop() }, "下载")));
    return;
  }
  const reload = () => showFile(appId, path, view);
  const editor = h("textarea", { class: "editor" }, file.content), status = h("span", { class: "muted" });
  const save = async () => {
    try { await steward(`/apps/${appId}/file`, { method: "PUT", body: { path, content: editor.value, baseRevision: file.revision } }); status.textContent = "已保存"; await reload(); }
    catch (error) { status.textContent = error.message; }
  };
  const toggle = async (line, checked) => {
    try { await steward(`/apps/${appId}/checkbox`, { method: "POST", body: { path, line, checked, baseRevision: file.revision } }); await reload(); }
    catch (error) { alert(error.message); await reload(); }
  };
  const rendered = /\.md$/i.test(path) ? markdown(file, toggle) : h("pre", {}, /\.json$/i.test(path) ? (() => { try { return JSON.stringify(JSON.parse(file.content), null, 2); } catch { return file.content; } })() : file.content);
  view.replaceChildren(h("div", { class: "row" }, h("h3", { style: "flex:1" }, path), h("span", { class: "muted" }, when(file.updatedAt))), rendered,
    h("details", {}, h("summary", {}, "编辑"), editor, h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "保存"), status)));
}

// ----------------------------------------------------------------- router --
async function route() {
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  replyListeners.clear();
  try {
    if (parts[0] === "chat") await chat(null);
    else if (parts[0] === "sessions" && parts[1]) await chat(parts[1]);
    else if (parts[0] === "apps" && parts[1]) await app(parts[1], url.searchParams.get("path"));
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
  const key = localStorage.getItem(KEY);
  document.getElementById("logout").hidden = !key;
  const response = await fetch("/api/workspaces", { headers: auth() });
  if (response.status === 401) { login(key ? "密钥不正确，请重新输入。" : undefined); return; }
  workspaceId = (await response.json())[0]?.id ?? null;
  if (!workspaceId) { main.replaceChildren(h("p", { class: "error" }, "没有工作区。")); return; }
  if (!listening) { listening = true; void listen(); }
  await route();
}
void start();
