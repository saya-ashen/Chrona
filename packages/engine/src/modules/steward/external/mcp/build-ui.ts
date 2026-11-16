import { join } from "node:path";

/** Compile app-owned TSX against Web's single React runtime, exporting source for page-set. */
export async function buildApplicationUI(directory: string, entry = "settings-ui.tsx", output = "settings-bundle.js") {
  const transpiler = new Bun.Transpiler({ loader: "tsx", tsconfig: {
    compilerOptions: { jsx: "react", jsxFactory: "React.createElement", jsxFragmentFactory: "React.Fragment" },
  } });
  const result = await Bun.build({
    entrypoints: [join(directory, entry)], target: "browser", format: "esm", minify: true,
    plugins: [{ name: "shared-web-runtime", setup(build) {
      build.onResolve({ filter: /^\/pages\.js$/ }, () => ({ path: "/pages.js", external: true }));
      build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
        contents: transpiler.transformSync(await Bun.file(path).text()), loader: "js",
      }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, "Application page build failed");
  await Bun.write(join(directory, output), `// Generated browser ESM from ${entry}; do not edit.\nexport const javascript = ${JSON.stringify(await result.outputs[0]!.text())};\n`);
}
if (import.meta.main) await buildApplicationUI(import.meta.dir, process.argv[2], process.argv[3]);
