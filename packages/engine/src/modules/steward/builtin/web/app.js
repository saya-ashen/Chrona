// Chrona's shell: authentication, router and one SSE connection. All pages render through /pages.js.
// Data comes from /api/web through routed calls for the user (v2-8); requests carry the user's key.
const KEY = "chrona.accessKey"; // the same key the previous web app stored
const main = document.getElementById("main");

class Unauthorized extends Error {}
const auth = () => { const key = localStorage.getItem(KEY); return key ? { authorization: `Bearer ${key}` } : {}; };

async function request(url, { method = "GET", body, raw = false } = {}) {
  const response = await fetch(url, { method, headers: { ...auth(), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) throw new Unauthorized();
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.code || `请求失败（${response.status}）`);
  }
  if (method === "POST") void pageLinks();
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

const login = message => systemPage({ name: "login", message });

// ------------------------------------------------------------ app pages --
// Pages apps register (module-dependency-direction §4): drawn by pages.js with module-scoped calls.
let unmountPage = null;
async function registeredPage(module, id) {
  const page = await web(`/pages/${encodeURIComponent(module)}/${encodeURIComponent(id)}`);
  const { mount } = await import("/pages.js");
  main.replaceChildren();
  unmountPage = mount(main, page, { call: (target, args) => web("/call", { method: "POST", body: { target, args, page: { module: page.module, id: page.id, revision: page.revision } } }), navigate: path => go(path), content: path => web(path, { raw: true }) });
}
async function systemPage(params) {
  const { mountSystem } = await import("/pages.js");
  unmountPage?.();
  main.replaceChildren();
  const systemWeb = async (path, options) => {
    try { return await web(path, options); }
    catch (error) { if (error instanceof Unauthorized) await login("密钥不正确，请重新输入。"); throw error; }
  };
  unmountPage = mountSystem(main, params, { web: systemWeb, tool, subscribe: listener => { replyListeners.add(listener); return () => replyListeners.delete(listener); }, login: async key => { localStorage.setItem(KEY, key); await start(); } }, (path, replace) => go(path, replace));
}
const pageHref = page => `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`;
async function pageLinks() {
  const nav = document.querySelector("header nav"), apps = nav.querySelector('a[href="/apps"]');
  let pages;
  try { pages = await web("/pages"); } catch { return; }
  nav.querySelectorAll("a[data-page]").forEach(link => link.remove());
  for (const page of pages) {
    const link = document.createElement("a");
    link.href = pageHref(page); link.dataset.page = ""; link.textContent = page.title;
    apps.before(link);
  }
}

// ----------------------------------------------------------------- router --
async function route() {
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  unmountPage?.(); unmountPage = null;
  if (localStorage.getItem(KEY)) void pageLinks();
  try {
    if (parts[0] === "chat" || (parts[0] === "sessions" && parts[1])) await systemPage({ name: "chat", path: url.pathname });
    else if (parts[0] === "p" && parts[1] && parts[2]) await registeredPage(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    else if (parts[0] === "settings") await systemPage({ name: "settings" });
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemPage({ name: "system-app", id: decodeURIComponent(parts[2]), tab: url.searchParams.get("tab") ?? "overview", session: url.searchParams.get("session") ?? "" });
    else if (parts[0] === "apps" && parts[1]) await systemPage({ name: "app", id: decodeURIComponent(parts[1]), tab: url.searchParams.get("tab") ?? "overview", session: "" });
    else if (parts[0] === "apps") await systemPage({ name: "apps" });
    else if (parts[0] === "activity") await systemPage({ name: "activity", module: url.searchParams.get("module") ?? "" });
    else await systemPage({ name: "today" });
  } catch (error) {
    if (error instanceof Unauthorized) await login(localStorage.getItem(KEY) ? "密钥不正确，请重新输入。" : undefined);
    else await systemPage({ name: "error", message: error.message });
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
