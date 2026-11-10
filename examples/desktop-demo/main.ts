import { join } from "node:path";
// The existing Bun script launcher supplies CHRONA_SDK and its resolver.
// Explicit native/interpreter objects speak IPC directly and do not receive it.
await import(join(import.meta.dirname, "dist/entry.js"));
