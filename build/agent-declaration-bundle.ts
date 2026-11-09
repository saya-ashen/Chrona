import { relative, sep } from "node:path";
import ts from "typescript";

/** Place an authored declaration graph in one file, retaining every declaration
 * and module scope. Ambient modules support recursive types inside that file
 * without cyclic package files or flattened/approximated public types. */
export function bundleDeclarations(name: string, dir: string, program: ts.Program, entry: string) {
  const sources = program.getSourceFiles().filter(file => file.fileName.startsWith(dir + sep) && !relative(dir, file.fileName).split(sep).includes("node_modules"));
  const moduleNames = new Map(sources.map(file => [file.fileName, file.fileName === entry ? name : `${name}/__declarations/${relative(dir, file.fileName).split(sep).join("/")}`]));
  const printer = ts.createPrinter({ removeComments: false });
  return sources.map(file => {
    const source = ts.createSourceFile(file.fileName, file.text, ts.ScriptTarget.Latest, true);
    if (!source.isDeclarationFile) throw new Error(`Expected authored declarations for ${name}: ${source.fileName}`);
    const transformed = ts.transform(source, [context => root => {
      const visit: ts.Visitor = node => {
        if (ts.isStringLiteral(node) && ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node || ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent))) {
          const resolved = ts.resolveModuleName(node.text, source.fileName, program.getCompilerOptions(), ts.sys).resolvedModule;
          const target = resolved && moduleNames.get(resolved.resolvedFileName);
          if (target) return ts.factory.createStringLiteral(target);
          if (node.text.startsWith(".")) throw new Error(`Unbundled declaration import: ${source.fileName}: ${node.text}`);
        }
        if (node.kind === ts.SyntaxKind.DeclareKeyword && node.parent.parent === source) return undefined;
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit) as ts.SourceFile;
    }]);
    try {
      return `declare module ${JSON.stringify(moduleNames.get(source.fileName))} {\n${printer.printFile(transformed.transformed[0]!)}\n}\n`;
    } finally { transformed.dispose(); }
  }).join("\n");
}
