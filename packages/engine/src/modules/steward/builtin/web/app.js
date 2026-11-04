// Chrona's router and remaining DOM pages. System and registered app pages share /pages.js.
// Data comes from /api/web through routed calls for the user (v2-8); requests carry the user's key.
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

const login = message => systemPage("login", message);

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

// ------------------------------------------------------------ app pages --
// Pages apps register (module-dependency-direction §4): drawn by pages.js with module-scoped calls.
let unmountPage = null;
async function registeredPage(module, id) {
  const page = await web(`/pages/${encodeURIComponent(module)}/${encodeURIComponent(id)}`);
  const { mount } = await import("/pages.js");
  const view = h("div", {});
  main.replaceChildren(h("h2", {}, page.title), view);
  unmountPage = mount(view, page, { call: (target, args) => tool(target, args), navigate: path => go(path), content: path => web(path, { raw: true }) });
}
async function systemPage(name, message) {
  const { mountSystem } = await import("/pages.js");
  unmountPage?.();
  main.replaceChildren();
  const systemWeb = async (path, options) => {
    try { return await web(path, options); }
    catch (error) { if (error instanceof Unauthorized) await login("密钥不正确，请重新输入。"); throw error; }
  };
  unmountPage = mountSystem(main, name, { web: systemWeb, tool, login: async key => { localStorage.setItem(KEY, key); await start(); } }, path => go(path), message);
}
const pageHref = page => `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`;
async function pageLinks() {
  const nav = document.querySelector("header nav"), apps = nav.querySelector('a[href="/apps"]');
  nav.querySelectorAll("a[data-page]").forEach(link => link.remove());
  for (const page of await web("/pages").catch(() => [])) apps.before(h("a", { href: pageHref(page), "data-page": "" }, page.title));
}

// ----------------------------------------------------------------- router --
async function route() {
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  replyListeners.clear();
  unmountPage?.(); unmountPage = null;
  try {
    if (parts[0] === "chat") await chat(null);
    else if (parts[0] === "sessions" && parts[1]) await chat(parts[1]);
    else if (parts[0] === "p" && parts[1] && parts[2]) await registeredPage(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    else if (parts[0] === "settings") await systemPage("settings");
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemPage("system-app", JSON.stringify({ id: decodeURIComponent(parts[2]), tab: url.searchParams.get("tab") ?? "overview", session: url.searchParams.get("session") ?? "" }));
    else if (parts[0] === "apps" && parts[1]) await systemPage("app", JSON.stringify({ id: decodeURIComponent(parts[1]), tab: url.searchParams.get("tab") ?? "overview", session: "" }));
    else if (parts[0] === "apps") await systemPage("apps");
    else if (parts[0] === "activity") await systemPage("activity", url.searchParams.get("module") ?? "");
    else await systemPage("today");
  } catch (error) {
    if (error instanceof Unauthorized) await login(localStorage.getItem(KEY) ? "密钥不正确，请重新输入。" : undefined);
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
  if (!localStorage.getItem(KEY)) { await login(); return; }
  try { await web("/today"); }
  catch (error) { if (error instanceof Unauthorized) { await login("密钥不正确，请重新输入。"); return; } }
  // Stops on a wrong key; the next start (after login) listens again.
  if (!listening) { listening = true; void listen().finally(() => { listening = false; }); }
  void pageLinks();
  await route();
}
void start();
