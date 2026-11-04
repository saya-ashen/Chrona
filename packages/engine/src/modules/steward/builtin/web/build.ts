// Builds src/pages.tsx (React + json-render for system and registered app pages) into the shipped pages.js.
// Run `bun build.ts` after changing src/ or catalog.ts; pages.js is committed so the module itself needs no build step.
const result = await Bun.build({ entrypoints: ["src/pages.tsx"], target: "browser", format: "esm", minify: true, define: { "process.env.NODE_ENV": '"production"' } });
if (!result.success) throw new Error(result.logs.join("\n"));
await Bun.write("pages.js", `// Built from src/pages.tsx by build.ts; do not edit.\n${await result.outputs[0]!.text()}`);
export {};
