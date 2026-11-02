// v2-25: type-checks a module's entry (and what it imports) against the `chrona` SDK and the generated call contracts.
// Usage: bun check.ts <moduleDir> <sdkDir>. Only reads files, never runs module code. Prints { errors } as JSON; exits 1 on errors.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const [moduleDir, sdkDir] = process.argv.slice(2).map(path => resolve(path));
if (!moduleDir || !sdkDir) { console.error("Usage: bun check.ts <moduleDir> <sdkDir>"); process.exit(2); }
const entry = join(moduleDir, (JSON.parse(readFileSync(join(moduleDir, "module.json"), "utf8")) as { entry: string }).entry);
const options: ts.CompilerOptions = {
  strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, esModuleInterop: true, resolveJsonModule: true, allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  // Bun's own types ship beside this script; the module's dependencies resolve from its node_modules.
  types: ["bun"], typeRoots: [dirname(dirname(Bun.resolveSync("@types/bun/package.json", import.meta.dir)))],
  paths: { chrona: [join(sdkDir, "sdk.ts")], "chrona/testing": [join(sdkDir, "testing.ts")], "chrona/preview": [join(sdkDir, "preview.ts")] },
};
const program = ts.createProgram([entry], options), checker = program.getTypeChecker();
const own = (file: ts.SourceFile) => file.fileName.startsWith(moduleDir + sep) && !file.fileName.includes(`${sep}node_modules${sep}`);
// A missing declaration file for a dependency says nothing about Chrona's contracts.
const ignored = new Set([7016]);
const errors: { file: string; line: number; code: number; message: string }[] = [];
function report(file: ts.SourceFile | undefined, start: number | undefined, code: number, message: string) {
  const line = file && start !== undefined ? file.getLineAndCharacterOfPosition(start).line + 1 : 0;
  errors.push({ file: file ? relative(moduleDir, file.fileName) : "", line, code, message });
}
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  if (ignored.has(diagnostic.code) || (diagnostic.file && !own(diagnostic.file))) continue;
  report(diagnostic.file, diagnostic.start, diagnostic.code, ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}
// A declared result is the type: `chrona.call<T>("<target with a declared output>")` would override it with a guess.
const calls = program.getSourceFile(join(sdkDir, "calls.d.ts")), contracts = new Set<string>();
const declared = calls && checker.getSymbolAtLocation(calls)?.exports?.get(ts.escapeLeadingUnderscores("ChronaCalls"));
for (const property of declared ? checker.getDeclaredTypeOfSymbol(declared).getProperties() : []) {
  const output = checker.getTypeOfSymbolAtLocation(property, calls!).getProperty("output");
  if (output && !(checker.getTypeOfSymbolAtLocation(output, calls!).flags & ts.TypeFlags.Unknown)) contracts.add(property.name);
}
function visit(node: ts.Node, file: ts.SourceFile) {
  if (ts.isCallExpression(node) && node.typeArguments?.length && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "call"
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "chrona") {
    const [target] = node.arguments;
    if (ts.isStringLiteralLike(target) && contracts.has(target.text))
      report(file, node.getStart(file), 90001, `${target.text} has a declared contract: remove the type argument and use the declared result type`);
  }
  ts.forEachChild(node, child => visit(child, file));
}
for (const file of program.getSourceFiles()) if (own(file)) visit(file, file);
console.log(JSON.stringify({ errors: errors.slice(0, 50), total: errors.length }));
process.exit(errors.length ? 1 : 0);
