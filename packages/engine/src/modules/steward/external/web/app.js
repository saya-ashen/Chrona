// Chrona's shell: authentication, router and one SSE connection. All pages render through /pages.js.
// Normal API and SSE requests use the server's HttpOnly session cookie.
const KEY = "chrona.accessKey"; // Read only to migrate an existing first-password setup authorization.
let bootstrapKey = localStorage.getItem(KEY) ?? "", authStatus = null;
let loginParams = { name: "login", mode: "error", message: "正在读取登录状态……" };
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
    const current = authenticated && (href === path || (href === "/today" && path === "/") || (href === "/apps" && path.startsWith("/apps/")));
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

class Unauthorized extends Error {}

async function request(url, { method = "GET", body, raw = false } = {}) {
  const currentSession = session;
  const response = await fetch(url, { method, credentials: "same-origin", headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) {
    if (authenticated && currentSession === session) await login("登录已过期，请重新登录。");
    throw new Unauthorized();
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.code || `请求失败（${response.status}）`);
  }
  return raw ? response.blob() : response.json();
}
let pagesRead = null;
function web(path, options) {
  if (path !== "/pages" || (options?.method ?? "GET") !== "GET") return request(`/api/web${path}`, options);
  // Navigation and settings can request the same display inventory together.
  // Share only an in-flight read in this login session; later reads stay fresh.
  if (pagesRead?.session === session) return pagesRead.promise;
  const current = { session, promise: null };
  current.promise = request("/api/web/pages", options).finally(() => { if (pagesRead === current) pagesRead = null; });
  pagesRead = current;
  return current.promise;
}
// A module tool, through the page's data API (Chrona checks what this page may call).
const tool = (target, args = {}) => web("/call", { method: "POST", body: { target, args } });

// Replies to web conversations, pushed over a cookie-authenticated SSE fetch.
const replyListeners = new Set();
async function listen(signal) {
  const currentSession = session;
  while (!signal.aborted) {
    try {
      const response = await fetch("/api/web/events", { signal, credentials: "same-origin", headers: { accept: "text/event-stream" } });
      if (response.status === 401) {
        if (!signal.aborted && currentSession === session) await login("登录已过期，请重新登录。");
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

function login(message, mode = authStatus?.passwordSet ? "login" : authStatus?.canSetup ? "setup" : "bootstrap") {
  authenticated = false; session++; navigation++;
  loginParams = { name: "login", message, mode };
  stream?.abort(); stream = null;
  unmountPage?.(); unmountPage = null;
  shellState();
  return systemPage(loginParams);
}

// ------------------------------------------------------------ app pages --
// Pages apps register (module-dependency-direction §4): drawn by pages.js with module-scoped calls.
let unmountPage = null;
async function registeredPage(module, id, version) {
  const loading = document.createElement("p");
  loading.setAttribute("role", "status"); loading.textContent = "正在读取应用页面……";
  main.replaceChildren(loading);
  const [page, { mount, registeredDeps }] = await Promise.all([
    web(`/pages/${encodeURIComponent(module)}/${encodeURIComponent(id)}`),
    import("/pages.js"),
  ]);
  if (version !== navigation || !authenticated) return;
  shellState(page.layout);
  main.replaceChildren();
  unmountPage = mount(main, page, registeredDeps(page, web, (path, replace) => go(path, replace)));
}
async function systemPage(params, version = navigation) {
  const { mountSystem } = await import("/pages.js");
  if (version !== navigation) return;
  shellState();
  unmountPage?.();
  main.replaceChildren();
  unmountPage = mountSystem(main, params, { web, tool, subscribe: listener => { replyListeners.add(listener); return () => replyListeners.delete(listener); }, auth: systemAuth }, (path, replace) => go(path, replace));
}
const pageHref = page => `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`;
let linksPending = null, linksSession = -1, linksReadAt = 0;
function pageLinks() {
  if (!authenticated) return;
  if (linksSession === session && linksPending) return linksPending;
  if (linksSession === session && Date.now() - linksReadAt < 30000) return;
  linksSession = session;
  const requestId = ++linksRequest;
  linksPending = readPageLinks(requestId).finally(() => { if (requestId === linksRequest) linksPending = null; });
  return linksPending;
}
// Navigation is a display snapshot. Page loads and calls validate identity and
// contracts on the server independently of this refresh interval.
setInterval(() => { if (!document.hidden) void pageLinks(); }, 30000);
async function readPageLinks(requestId) {
  const currentSession = session;
  const apps = nav.querySelector('a[href="/apps"]');
  let pages;
  try { pages = await web("/pages"); }
  catch (error) { console.error(JSON.stringify({ component: "web-shell", event: "navigation-read-failed", error: error.message })); return; }
  if (!authenticated || currentSession !== session || requestId !== linksRequest) return;
  linksReadAt = Date.now();
  nav.querySelectorAll("a[data-page]").forEach(link => link.remove());
  // Keep one stable Chat destination even when its application is unavailable.
  // All other entries continue to come from the registered display inventory.
  const chat = pages.find(page => page.module === "chat" && page.id === "main" && page.purpose !== "settings");
  const entries = [{ ...chat, module: "chat", id: "main", title: "Chat" }, ...pages.filter(page => page.purpose !== "settings" && !(page.module === "chat" && page.id === "main"))];
  for (const page of entries) {
    const link = document.createElement("a");
    link.href = pageHref(page); link.dataset.page = ""; link.textContent = page.title;
    link.title = page.title;
    apps.before(link);
  }
  activeNavigation();
}

// ----------------------------------------------------------------- router --
async function route() {
  if (!authenticated) { await systemPage(loginParams); return; }
  const version = ++navigation;
  const url = new URL(location.href);
  if (["/chat", "/conversations", "/chat/new", "/history"].includes(url.pathname) || url.pathname.startsWith("/sessions/")) {
    if (url.pathname === "/chat/new") url.searchParams.set("new", "1");
    url.pathname = "/p/chat/main";
    history.replaceState(null, "", url);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  let chatPage = false;
  unmountPage?.(); unmountPage = null;
  shellState();
  main.replaceChildren();
  void pageLinks();
  try {
    if (parts[0] === "p" && parts[1] && parts[2]) {
      const module = decodeURIComponent(parts[1]), id = decodeURIComponent(parts[2]);
      chatPage = module === "chat" && id === "main";
      await registeredPage(module, id, version);
    }
    else if (parts[0] === "settings") await systemPage({ name: "settings" });
    else if (parts[0] === "apps" && parts[1] === "system" && parts[2]) await systemPage({ name: "system-app", id: decodeURIComponent(parts[2]), tab: url.searchParams.get("tab") ?? "overview", session: url.searchParams.get("session") ?? "" });
    else if (parts[0] === "apps" && parts[1]) await systemPage({ name: "app", id: decodeURIComponent(parts[1]), tab: url.searchParams.get("tab") ?? "overview", session: "" });
    else if (parts[0] === "apps") await systemPage({ name: "apps" });
    else if (parts[0] === "activity") await systemPage({ name: "activity", module: url.searchParams.get("module") ?? "" });
    else await systemPage({ name: "today" });
  } catch (error) {
    if (version !== navigation) return;
    if (error instanceof Unauthorized) return; // request() already handles a 401 from the current session.
    console.error(JSON.stringify({ component: "web-shell", event: "page-load-failed", path: url.pathname, error: error.message }));
    await systemPage(chatPage
      ? { name: "chat-unavailable", message: `Chat 应用页面暂时无法打开：${error.message}。请前往应用检查 Chat 是否已安装、启用并登记主页面。` }
      : { name: "error", message: error.message }, version);
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
document.getElementById("logout").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await authRequest("/logout", { method: "POST", body: {} }); await login(); }
  catch (error) { await systemPage({ name: "error", message: `退出登录失败：${error.message}` }); }
  finally { button.disabled = false; }
});

function clearBootstrapKey() {
  bootstrapKey = "";
  localStorage.removeItem(KEY);
}
async function authRequest(path, { method = "GET", body } = {}) {
  const bearer = authStatus?.passwordSet === false && bootstrapKey && (path === "/status" || path === "/setup");
  const response = await fetch(`/api/auth${path}`, { method, credentials: "same-origin", headers: { ...(bearer ? { authorization: `Bearer ${bootstrapKey}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const messages = { 400: "密码长度应为 10–256 个字符。", 401: path === "/password" ? "当前密码不正确或登录已过期，请重试或重新登录。" : "密码不正确，请重试。", 403: "需要原访问授权才能设置首个密码。", 409: "登录密码已设置，请重新读取登录状态。", 429: "尝试次数过多，请稍后重试。" };
    throw new Error(messages[response.status] || error.message || error.error || error.code || `登录服务请求失败（${response.status}）`);
  }
  return response.status === 204 ? null : response.json();
}
async function systemAuth(path, options = {}) {
  if (path === "/status") {
    if (typeof options.accessKey === "string" && authStatus?.passwordSet === false) bootstrapKey = options.accessKey.trim();
    return start();
  }
  if (!["/login", "/setup", "/password"].includes(path)) throw new Error("未知登录操作");
  const currentSession = session, result = await authRequest(path, options);
  if (currentSession !== session) return result;
  if (path === "/setup") clearBootstrapKey();
  if (path === "/password") {
    // A password change rotates the current cookie. Ignore 401s from requests using the previous session.
    session++;
    stream?.abort(); stream = new AbortController(); void listen(stream.signal);
  } else await start();
  return result;
}
function readStatus(value) {
  if (!value || ["passwordSet", "authenticated", "canSetup"].some(key => typeof value[key] !== "boolean")) throw new Error("登录状态响应无效，请重试。");
  if (value.passwordSet) clearBootstrapKey();
  return value;
}
async function start() {
  const currentSession = ++session;
  try {
    // Learn whether a password exists before sending any saved bootstrap authorization.
    let status = await authRequest("/status");
    if (currentSession !== session) return;
    authStatus = readStatus(status);
    if (!authStatus.passwordSet && bootstrapKey) {
      status = await authRequest("/status");
      if (currentSession !== session) return;
      authStatus = readStatus(status);
    }
  } catch (error) {
    if (currentSession === session) await login(`认证状态读取失败：${error.message}`, "error");
    return;
  }
  if (!authStatus.passwordSet || !authStatus.authenticated) { await login(); return; }
  authenticated = true;
  shellState();
  if (!stream) { stream = new AbortController(); void listen(stream.signal); }
  await route();
}
void start();
