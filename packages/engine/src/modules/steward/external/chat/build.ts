import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
const r=await Bun.build({entrypoints:['ui.ts'],outdir:'dist',naming:'ui.js',target:'browser',minify:false});
if(!r.success)throw new AggregateError(r.logs,'build failed');
