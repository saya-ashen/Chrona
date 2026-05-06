// scripts/replace-deprecated-plan-types.mjs
import { Project, SyntaxKind, Node } from "ts-morph";

const dryRun = process.argv.includes("--dry");

const replacements = new Map([
  ["PlanBlueprintNodeType", "PlanNodeType"],
  ["AIPlanNodeType", "PlanNodeType"],
  ["AIPlanNode", "PlanBlueprintNode"],
  ["AITaskNode", "PlanBlueprintTaskNode"],
  ["AICheckpointNode", "PlanBlueprintCheckpointNode"],
  ["AIConditionNode", "PlanBlueprintConditionNode"],
  ["AIWaitNode", "PlanBlueprintWaitNode"],
  ["AIPlanEdge", "PlanBlueprintEdge"],
  ["AIPlanOutput", "PlanBlueprint"],
]);

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

const changedFiles = new Set();

function getLocation(node) {
  const sourceFile = node.getSourceFile();
  const pos = sourceFile.getLineAndColumnAtPos(node.getStart());

  return `${sourceFile.getFilePath()}:${pos.line}:${pos.column}`;
}

function isAliasDeclarationName(node, aliasDecl) {
  return (
    node.getStart() === aliasDecl.getNameNode().getStart() &&
    node.getSourceFile().getFilePath() ===
      aliasDecl.getSourceFile().getFilePath()
  );
}

function replaceAliasReferences(aliasDecl, oldName, newName) {
  const refs = aliasDecl.findReferencesAsNodes();

  for (const ref of refs) {
    // 跳过旧 alias 自己的声明名：
    // export type AIPlanNode = PlanBlueprintNode;
    if (isAliasDeclarationName(ref, aliasDecl)) {
      continue;
    }

    const text = ref.getText();

    // 通常 findReferencesAsNodes 已经是语义级引用了；
    // 这里再加一层文本保护，避免替换意外节点。
    if (text !== oldName) {
      continue;
    }

    console.log(
      `${dryRun ? "[dry]" : "[replace]"} ${oldName} -> ${newName} at ${getLocation(ref)}`,
    );

    if (!dryRun) {
      ref.replaceWithText(newName);
      changedFiles.add(ref.getSourceFile().getFilePath());
    }
  }
}

function removeDuplicateNamedImports() {
  for (const sourceFile of project.getSourceFiles()) {
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const seen = new Set();

      for (const namedImport of importDecl.getNamedImports()) {
        const name = namedImport.getName();
        const alias = namedImport.getAliasNode()?.getText() ?? "";
        const key = `${name}::${alias}`;

        if (seen.has(key)) {
          console.log(
            `${dryRun ? "[dry]" : "[remove duplicate import]"} ${name} at ${getLocation(namedImport)}`,
          );

          if (!dryRun) {
            namedImport.remove();
            changedFiles.add(sourceFile.getFilePath());
          }
        } else {
          seen.add(key);
        }
      }

      const hasDefault = Boolean(importDecl.getDefaultImport());
      const hasNamespace = Boolean(importDecl.getNamespaceImport());
      const hasNamed = importDecl.getNamedImports().length > 0;

      if (!hasDefault && !hasNamespace && !hasNamed) {
        console.log(
          `${dryRun ? "[dry]" : "[remove empty import]"} at ${getLocation(importDecl)}`,
        );

        if (!dryRun) {
          importDecl.remove();
          changedFiles.add(sourceFile.getFilePath());
        }
      }
    }
  }
}

for (const sourceFile of project.getSourceFiles()) {
  for (const aliasDecl of sourceFile.getTypeAliases()) {
    const oldName = aliasDecl.getName();
    const newName = replacements.get(oldName);

    if (!newName) {
      continue;
    }

    replaceAliasReferences(aliasDecl, oldName, newName);
  }
}

removeDuplicateNamedImports();

if (!dryRun) {
  await project.save();
}

console.log("");
console.log(
  `Done. ${dryRun ? "No files were written." : `Changed ${changedFiles.size} files.`}`,
);
