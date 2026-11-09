// Builds src/pages.tsx (React + json-render for system and registered app pages) into the shipped pages.js.
// Run `bun build.ts` after changing src/ or catalog.ts; pages.js is committed so the module itself needs no build step.
const result = await Bun.build({ entrypoints: ["src/pages.tsx"], target: "browser", format: "esm", minify: true, define: { "process.env.NODE_ENV": '"production"' } });
if (!result.success) throw new Error(result.logs.join("\n"));
await Bun.write("pages.js", `// Built from src/pages.tsx by build.ts; do not edit.\n${await result.outputs[0]!.text()}`);
export {};

// Serve renderer and shell styles through the existing same-origin stylesheet under the Web CSP.
// These markers own the generated sections; repeated builds never duplicate either section.
const rendererMarker = "/* Shared renderer primitives:";
const shellMarker = "/* Web shell theme:";
const base = (await Bun.file("style.css").text()).split(rendererMarker)[0]!.split(shellMarker)[0]!.trimEnd();
await Bun.write("style.css", `${base}\n\n${(await Bun.file("src/pages.css").text()).trimEnd()}\n\n${(await Bun.file("shell.css").text()).trimEnd()}\n`);
