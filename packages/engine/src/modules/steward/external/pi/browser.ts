import { accessSync, constants, realpathSync, statSync } from "node:fs";

/** Chromium-compatible programs tried on PATH, in order. Bun.which handles the host PATH delimiter and PATHEXT. */
const NAMES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "chrome", "msedge"];
type Options = {
  /** Explicit browser executable (CHRONA_STEWARD_BROWSER). */
  configured?: string;
  /** PATH to search (default: Chrona's). */
  path?: string;
};
function executable(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  try {
    const path = realpathSync(candidate);
    if (!statSync(path).isFile()) return null;
    accessSync(path, constants.X_OK);
    return path;
  } catch { return null; }
}

/** Resolve an explicit or installed browser on each run. Browser installation belongs to the host owner. */
export function createBrowsers(options: Options = {}) {
  function find(): string | null {
    const configured = executable(options.configured);
    if (configured) return configured;
    for (const name of NAMES) {
      const found = executable(Bun.which(name, options.path === undefined ? undefined : { PATH: options.path }));
      if (found) return found;
    }
    return null;
  }
  return { find, ensure: find };
}
export type Browsers = ReturnType<typeof createBrowsers>;
