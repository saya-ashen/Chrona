import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fixturesDir = join(import.meta.dir, "fixtures");

export function readCalendarFixture(name: string) {
  return readFile(join(fixturesDir, name), "utf8");
}
