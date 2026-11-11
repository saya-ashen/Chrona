import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemContext } from "./system/action";
import { systemCall } from "./system/adapter";
import { LoginForm, LoginPasswordSettings } from "./system/password-forms";
import { loginSpec } from "./system/login";
import { settingsSpec } from "./system/settings";

const unavailable = async () => { throw new Error("Credentials must never reach the Web module proxy"); };
describe("system password forms and auth boundary", () => {
  test("auth operations use only the dedicated host with exact password bytes and payloads", async () => {
    const requests: unknown[] = [];
    const call = systemCall({ web: unavailable, tool: unavailable, auth: async (...args) => { requests.push(args); return {}; } });
    await call("$web.auth-status", {});
    await call("$web.auth-status", { accessKey: "original-access" });
    await call("$web.auth-setup", { password: " new password ", confirmPassword: "never sent" });
    await call("$web.login", { password: " new password " });
    await call("$web.auth-password", { currentPassword: " old password ", password: " new password ", confirmPassword: "never sent" });
    expect(requests).toEqual([
      ["/status", undefined],
      ["/status", { accessKey: "original-access" }],
      ["/setup", { method: "POST", body: { password: " new password " } }],
      ["/login", { method: "POST", body: { password: " new password " } }],
      ["/password", { method: "POST", body: { currentPassword: " old password ", password: " new password " } }],
    ]);
  });
  test("missing auth host fails explicitly without proxy fallback", async () => {
    const call = systemCall({ web: unavailable, tool: unavailable });
    for (const name of ["login", "auth-status", "auth-setup", "auth-password"]) await expect(call(`$web.${name}`, { password: "some-password" })).rejects.toThrow("无法访问登录服务");
  });
  test("status determines distinct login, setup, authorization and recovery forms", () => {
    const render = (mode: "login" | "setup" | "bootstrap" | "error") => renderToStaticMarkup(<SystemContext.Provider value={{ call: unavailable, refresh: () => {} }}><LoginForm props={{ mode }} /></SystemContext.Provider>);
    expect(render("login")).toContain('autoComplete="current-password"');
    expect(render("login")).not.toContain('name="confirmPassword"');
    const setup = render("setup");
    expect(setup.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(setup).toContain('minLength="10" maxLength="256"');
    expect(render("bootstrap")).toContain('name="accessKey"');
    expect(render("bootstrap")).not.toContain('name="password"');
    expect(render("error")).toContain("重新读取登录状态");
    expect(render("error")).not.toContain("<input");
    expect(JSON.stringify(loginSpec(undefined, "bootstrap"))).toContain("原访问授权");
    expect(JSON.stringify(loginSpec())).not.toContain("API_KEY");
  });
  test("Settings exposes the shared password component with current and new autocomplete", () => {
    const spec = settingsSpec({});
    expect(Object.values(spec.elements).some(node => node.type === "LoginPasswordSettings")).toBe(true);
    const form = renderToStaticMarkup(<SystemContext.Provider value={{ call: unavailable, refresh: () => {} }}><LoginPasswordSettings /></SystemContext.Provider>);
    expect(form).toContain('name="currentPassword"');
    expect(form.match(/autoComplete="current-password"/g)).toHaveLength(1);
    expect(form.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(form).toContain("更新登录密码");
  });
});
