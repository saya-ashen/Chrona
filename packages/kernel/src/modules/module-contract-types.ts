/** JSON Schema travels unchanged across the runtime boundary; null means undeclared. */
export type ModuleCallContracts = Record<string, { input: Record<string, unknown> | boolean | null; output: Record<string, unknown> | boolean | null }>;

type RuntimePrograms = { default: string[]; [platform: string]: string[] };
type ModuleRuntime = {
  extensions: string[];
  programs: RuntimePrograms;
  argv: string[];
  sdk?: boolean;
  preload?: string;
  venv?: { default: string; [platform: string]: string };
  check?: { programs: RuntimePrograms; argv: string[] };
};
export type ModuleRuntimes = { version: 1; runtimes: ModuleRuntime[] };
