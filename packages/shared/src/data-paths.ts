import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getChronaDataDir() {
  if (process.env.CHRONA_DATA_DIR?.trim()) {
    return resolve(process.env.CHRONA_DATA_DIR);
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "chrona");
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "chrona",
    );
  }
  return process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, "chrona")
    : join(homedir(), ".local", "share", "chrona");
}

export function getChronaGeneratedFilesDir() {
  return join(getChronaDataDir(), "generated");
}
