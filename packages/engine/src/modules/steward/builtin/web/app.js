// Chrona's shell: authentication, router and one SSE connection. All pages render through /pages.js.
// Data comes from /api/web through routed calls for the user (v2-8); requests carry the user's key.
const KEY = "chrona.accessKey"; // the same key the previous web app stored
const main = document.getElementById("main");
const header = document.querySelector("body > header");
const nav = header.querySelector("nav");
let authenticated = false, navigation = 0, session = 0, linksRequest = 0;
let stream = null;

function shellState(layout = "document") {
  document.body.classList.toggle("web-shell-app", authenticated);
  document.body.classList.toggle("web-shell-workspace", authenticated && layout === "workspace");
  document.body.classList.toggle("web-shell-login", !authenticated);
  nav.hidden = !authenticated;
  document.getElementById("logout").hidden = !authenticated;
  if (!authenticated) nav.querySelectorAll("a[data-page]").forEach(link => link.remove());
  activeNavigation();
}
function activeNavigation() {
  const path = location.pathname;
  for (const link of nav.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    const current = authenticated && (href === path || (href === "/today" && path === "/") || (href === "/chat" && path.startsWith("/sessions/")) || (href === "/apps" && path.startsWith("/apps/")));
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

class Unauthorized extends Error {}
const auth = () => { const key = localStorage.getItem(KEY); return key ? { authorization: `Bearer ${key}` } : {}; };

async function request(url, { method = "GET", body, raw = false } = {}) {
  const currentSession = session;
  const response = await fetch(url, { method, headers: { ...auth(), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) {
    if (authenticated && currentSession === session) await login("密钥不正确，请重新输入。");
    throw new Unauthorized();
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.code || `请求失败（${response.status}）`);
  }
  if (method === "POST" && currentSession === session) void pageLinks();
  return raw ? response.blob() : response.json();
}
const web = (path, options) => request(`/api/web${path}`, options);
// A module tool, through the page's data API (Chrona checks what this page may call).
const tool = (target, args = {}) => web("/call", { method: "POST", body: { target, args } });

// Replies to web conversations, pushed over SSE. fetch (not EventSource) so the request carries the key.
const replyListeners = new Set();
async function listen(signal) {
  while (!signal.aborted) {
    try {
      const response = await fetch("/api/web/events", { signal, headers: { ...auth(), accept: "text/event-stream" } });
      if (response.status === 401) {
        if (!signal.aborted) await login("密钥不正确，请重新输入。");
        return;
      }
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
          if (data && !signal.aborted) { const event = JSON.parse(data); for (const listener of replyListeners) listener(event); }
        }
      }
    } catch { /* reconnect below */ }
    if (!signal.aborted) await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

function login(message) {
  authenticated = false; session++; navigation++;
  localStorage.removeItem(KEY);
  stream?.abort(); stream = null;
  unmountPage?.(); unmountPage = null;
  shellState();
  return systemPage({ name: "login", message });
}

// ------------------------------------------------------------ app pages --
// Pages apps register (module-dependency-direction §4): drawn by pages.js with module-scoped calls.
let unmountPage = null;
async function registeredPage(module, id, version) {
  const page = await web(`/pages/${encodeURIComponent(module)}/${encodeURIComponent(id)}`);
  const { mount } = await import("/pages.js");
  if (version !== navigation || !authenticated) return;
  shellState(page.layout);
  main.replaceChildren();
  unmountPage = mount(main, page, { call: (target, args) => web("/call", { method: "POST", body: { target, args, page: { module: page.module, id: page.id, revision: page.revision } } }), navigate: path => go(path), content: path => web(path, { raw: true }) });
}
async function systemPage(params, version = navigation) {
  const { mountSystem } = await import("/pages.js");
  if (version !== navigation) return;
  shellState();
  unmountPage?.();
  main.replaceChildren();
  unmountPage = mountSystem(main, params, { web, tool, subscribe: listener => { replyListeners.add(listener); return () => replyListeners.delete(listener); }, login: async key => { localStorage.setItem(KEY, key); await start(); } }, (path, replace) => go(path, replace));
}
const pageHref = page => `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`;
async function pageLinks() {
  if (!authenticated) return;
  const currentSession = session, requestId = ++linksRequest;
  const apps = nav.querySelector('a[href="/apps"]');
  let pages;
  try { pages = await web("/pages"); } catch { return; }
  if (!authenticated || currentSession !== session || requestId !== linksRequest) return;
  nav.querySelectorAll("a[data-page]").forEach(link => link.remove());
  for (const page of pages) {
    const link = document.createElement("a");
    link.href = pageHref(page); link.dataset.page = ""; link.textContent = page.title;
    link.title = page.title;
    apps.before(link);
  }
  activeNavigation();
}

// ----------------------------------------------------------------- router --
async function route() {
  if (!authenticated) { await login(); return; }
  const version = ++navigation;
  const url = new URL(location.href), parts = url.pathname.split("/").filter(Boolean);
  unmountPage?.(); unmountPage = null;
  shellState();
  main.replaceChildren();
  void pageLinks();
  try {
    if (parts[0] === "chat" || (parts[0] === "sessions" && parts[1])) await systemPage({ name: "chat", path: url.pathname });
    else if (parts[0] === "p" && parts[1] && parts[2]) await registeredPage(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]), version);
    else if (parts[0] === "settings") await systemPage({ name: "settings" });
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemPage({ name: "system-app", id: decodeURIComponent(parts[2]), tab: url.searchParams.get("tab") ?? "overview", session: url.searchParams.get("session") ?? "" });
    else if (parts[0] === "apps" && parts[1]) await systemPage({ name: "app", id: decodeURIComponent(parts[1]), tab: url.searchParams.get("tab") ?? "overview", session: "" });
    else if (parts[0] === "apps") await systemPage({ name: "apps" });
    else if (parts[0] === "activity") await systemPage({ name: "activity", module: url.searchParams.get("module") ?? "" });
    else await systemPage({ name: "today" });
  } catch (error) {
    if (version !== navigation) return;
    if (error instanceof Unauthorized) await login("密钥不正确，请重新输入。");
    else await systemPage({ name: "error", message: error.message }, version);
  }
}
function go(path, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  void route();
}
document.addEventListener("click", event => {
  const link = event.target.closest("a[href^='/']");
  if (!link || link.hasAttribute("download") || link.target || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); go(link.getAttribute("href"));
});
addEventListener("popstate", () => void route());
document.getElementById("logout").addEventListener("click", () => void login());

async function start() {
  if (!localStorage.getItem(KEY)) { await login(); return; }
  const currentSession = ++session;
  try { await web("/today"); }
  catch (error) { if (error instanceof Unauthorized) { if (currentSession === session) await login("密钥不正确，请重新输入。"); return; } }
  if (currentSession !== session) return;
  authenticated = true;
  shellState();
  if (!stream) { stream = new AbortController(); void listen(stream.signal); }
  await route();
}
void start();
