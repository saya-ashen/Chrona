import fs from "node:fs";
import path from "node:path";
import type { TestRefs } from "./types";

interface MapSymbolEntry {
  name: string;
  tests?: string[];
}
interface MapFileEntry {
  file: string;
  directTests?: string[];
  transitiveTests?: string[];
  symbols?: MapSymbolEntry[];
}
interface FeatureTestMap {
  files?: MapFileEntry[];
}

const EMPTY: TestRefs = { direct: [], transitive: [], bySymbol: new Map() };

export function loadFeatureTestMap(file = path.join("docs", "maps", "feature-test-map.json")): FeatureTestMap | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as FeatureTestMap;
}

export function testRefsForSource(sourcePath: string, map = loadFeatureTestMap()): TestRefs {
  const entry = map?.files?.find((file) => file.file === sourcePath);
  if (!entry) return EMPTY;
  const bySymbol = new Map<string, { direct: string[]; transitive: string[] }>();
  for (const symbol of entry.symbols ?? []) {
    bySymbol.set(symbol.name, { direct: [...(symbol.tests ?? [])].sort(), transitive: [] });
  }
  return {
    direct: [...(entry.directTests ?? [])].sort(),
    transitive: [...(entry.transitiveTests ?? [])].sort(),
    bySymbol,
  };
}
