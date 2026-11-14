import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const directory = dirname(import.meta.path);
await mkdir(join(directory, 'dist'), { recursive: true });
const result = await Bun.build({
  entrypoints: [join(directory, 'workspace-ui.tsx')],
  outdir: join(directory, 'dist'),
  naming: 'workspace.js',
  target: 'browser',
  format: 'esm',
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
if (!result.success) throw new AggregateError(result.logs, 'Mind workspace build failed');
const javascript = await readFile(join(directory, 'dist/workspace.js'), 'utf8');
const css = await readFile(join(directory, 'workspace.css'), 'utf8');
// Leave room for the executable component's schema, tools and metadata (256 KiB total).
const bytes = Buffer.byteLength(javascript) + Buffer.byteLength(css);
if (bytes > 245 * 1024) throw Error(`Mind executable assets exceed the registration budget: ${bytes} bytes`);
console.log(`Mind workspace built: ${Buffer.byteLength(javascript)} JS bytes + ${Buffer.byteLength(css)} CSS bytes`);
