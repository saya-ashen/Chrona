export { React, createRoot, ui, registeredDeps, failure, PageView, AppSettings, mount } from "./application-pages";
export type { Page, Deps, PageHost } from "./application-pages";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RegisteredHost } from "./application-pages";
import { failure, type Deps } from "./registered-page";
import { systemCall, type SystemHost } from "./system/adapter";
import { SystemContext } from "./system/action";
import { SystemPage, type SystemParams } from "./system/page";
import { ChatHost } from "./system/chat-stream";
export function mountSystem(element: HTMLElement, params: SystemParams, host: SystemHost, navigate: Deps["navigate"]) {
  const root = createRoot(element),
    call = systemCall(host);
  function System() {
    const [revision, refresh] = useState(0);
    return (
      <RegisteredHost.Provider value={{ web: host.web, navigate }}>
        <ChatHost.Provider value={{ subscribe: host.subscribe ?? (() => () => {}), navigate }}>
          <SystemContext.Provider
            value={{
              call: async (tool, args) => {
                const result = await call(`$web.${tool}`, args),
                  error = failure(result);
                if (error) throw new Error(error);
                return result;
              },
              refresh: () => refresh((value) => value + 1),
              revision,
            }}
          >
            <div className="system-page">
              <SystemPage params={params} />
            </div>
          </SystemContext.Provider>
        </ChatHost.Provider>
      </RegisteredHost.Provider>
    );
  }
  root.render(<System />);
  return () => root.unmount();
}
