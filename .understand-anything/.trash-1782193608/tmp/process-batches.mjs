#!/usr/bin/env node
/**
 * Process all changed-file batches deterministically.
 * 1. Reads batches.json
 * 2. For each batch, writes input JSON + calls extract-structure.mjs
 * 3. Converts structural output to batch-<i>.json (GraphNode + GraphEdge format)
 * 4. Handles neighborMap for cross-batch edges
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.argv[2] || '/home/saya/workspace/Chrona';
const SKILL_DIR = process.argv[3] || '/home/saya/.understand-anything/repo/understand-anything-plugin/skills/understand';
const INTER = join(PROJECT_ROOT, '.understand-anything/intermediate');
const TMP = join(PROJECT_ROOT, '.understand-anything/tmp');

const batches = JSON.parse(readFileSync(join(INTER, 'batches.json'), 'utf-8')).batches;
mkdirSync(TMP, { recursive: true });

// Node type mapping by fileCategory
const CATEGORY_NODE_TYPE = {
  code: 'file',
  config: 'config',
  docs: 'document',
  data: 'table',
  infra: 'service', // overridden by language/path later
  script: 'file',
  markup: 'file',
};

// Default edge weights from schema
const EDGE_WEIGHTS = {
  contains: 1.0,
  inherits: 0.9,
  implements: 0.9,
  calls: 0.8,
  exports: 0.8,
  defines_schema: 0.8,
  imports: 0.7,
  deploys: 0.7,
  migrates: 0.7,
  depends_on: 0.6,
  configures: 0.6,
  triggers: 0.6,
  provisions: 0.7,
  serves: 0.7,
  routes: 0.6,
  tested_by: 0.5,
  documents: 0.5,
  related: 0.5,
};

// Tag heuristics
function guessTags(filePath, fileCategory, nonEmptyLines, exports, functions, classes) {
  const tags = [];
  const basename = filePath.split('/').pop();
  const dir = filePath.split('/').slice(0, -1).join('/');

  if (fileCategory === 'code') {
    if (filePath.includes('__tests__') || filePath.includes('.test.') || filePath.includes('.spec.')) tags.push('test');
    if (basename === 'index.ts' || basename === 'index.js') tags.push('barrel');
    if (basename === 'main.tsx' || basename === 'main.ts') tags.push('entry-point');
    if (functions.some(f => f.name.includes('Handler') || f.name.includes('Controller'))) tags.push('api-handler');
    if (classes.length > 0 && classes.every(c => c.name.endsWith('Service'))) tags.push('service');
    if (classes.length > 0 && classes.some(c => c.name.includes('Store') || c.name.includes('Repository'))) tags.push('data-access');
    if (nonEmptyLines < 50) tags.push('utility');
    if (exports.length === 0 && functions.length === 0 && classes.length === 0) tags.push('type-definition');
    if (filePath.endsWith('.tsx')) tags.push('component');
    if (filePath.includes('/hooks/') || basename.startsWith('use')) tags.push('hook');
    if (filePath.includes('middleware')) tags.push('middleware');
    if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx') || filePath.endsWith('.bun.test.ts')) tags.push('test');
    if (filePath.includes('/__tests__/')) tags.push('test');
    if (exports.some(e => typeof e === 'object' && (e.name === 'z' || e.name?.startsWith('z')))) tags.push('validation');
    if (classes.length > 0 && classes.some(c => c.name.includes('Event') || c.name.includes('Handler'))) tags.push('event-handler');
    if (filePath.includes('schema') || filePath.includes('types')) tags.push('type-definition');
  } else if (fileCategory === 'config') {
    tags.push('configuration');
    const cfgNames = ['tsconfig', 'eslint', 'prettier', 'postcss', 'tailwind', 'vite', 'jest', 'playwright'];
    if (cfgNames.some(n => basename.includes(n))) tags.push('build-system');
    if (basename === 'package.json') tags.push('dependency');
    if (basename === '.env' || basename.includes('.env')) tags.push('environment');
  } else if (fileCategory === 'docs') {
    tags.push('documentation');
    if (basename === 'README.md' || basename === 'readme.md') tags.push('entry-point');
    if (basename.includes('CONTRIBUTING')) tags.push('development');
    if (basename.includes('ARCHITECTURE') || basename.includes('architecture')) tags.push('architecture');
    if (basename.includes('CHANGELOG') || basename.includes('changelog')) tags.push('changelog');
  } else if (fileCategory === 'infra') {
    if (filePath.includes('Dockerfile') || filePath.includes('docker-compose')) {
      tags.push('containerization');
      tags.push('infrastructure');
    } else if (filePath.includes('.github/workflows') || filePath.includes('.gitlab-ci')) {
      tags.push('ci-cd');
      tags.push('deployment');
    } else if (filePath.endsWith('.tf') || filePath.includes('terraform')) {
      tags.push('infrastructure');
      tags.push('deployment');
    } else tags.push('infrastructure');
  }

  // deduplicate
  return [...new Set(tags)].length > 0 ? [...new Set(tags)] : ['untagged'];
}

function guessSummary(filePath, fileCategory, nonEmptyLines, functions, classes, exports) {
  const basename = filePath.split('/').pop();
  const dirParts = filePath.split('/');
  const moduleHint = dirParts.length > 2 ? dirParts[dirParts.length - 2] : '';

  const summaries = {
    test: `测试文件，覆盖 "${moduleHint}" 模块的功能验证。`,
    service: `服务层模块，提供 "${moduleHint}" 相关业务逻辑。`,
    barrel: `导出聚合文件，集中导出 "${moduleHint}" 模块的公共 API。`,
    component: `React 组件 "${basename.replace(/\.tsx?$/, '')}"。`,
    config: `配置文件 "${basename}"。`,
    docs: `文档 "${basename}"，提供项目相关说明。`,
    default: `源文件 "${filePath}"。`
  };

  if (fileCategory === 'test' || filePath.includes('.test.') || filePath.includes('__tests__')) {
    return summaries.test;
  }
  if (fileCategory === 'config') return summaries.config;
  if (fileCategory === 'docs') return summaries.docs;
  if (fileCategory === 'markup') return `标记文件 "${basename}"。`;
  if (fileCategory === 'infra') return `基础设施定义 "${filePath}"。`;
  if (fileCategory === 'script') return `脚本文件 "${basename}"。`;
  if (fileCategory === 'data') return `数据/模式定义文件 "${basename}"。`;

  const funcNames = functions.map(f => f.name);
  const classNames = classes.map(c => c.name);
  const parts = [];
  if (classNames.length) parts.push(`定义了 ${classNames.slice(0, 3).join('、')}${classNames.length > 3 ? '等' : ''} 类`);
  if (funcNames.length) parts.push(`包含 ${funcNames.slice(0, 3).join('、')}${funcNames.length > 3 ? '等' : ''} 函数`);

  return parts.length
    ? parts.join('，') + `，属于 "${moduleHint}" 模块。`
    : (basename === 'index.ts' || basename === 'index.js')
      ? `聚合导出"${moduleHint}"模块的公共 API。`
      : `实现 "${moduleHint}" 模块的 ${basename.replace(/\.\w+$/, '')} 功能。`;
}

function guessComplexity(nonEmptyLines, functions, classes) {
  if (nonEmptyLines > 200 || functions.length > 10 || classes.length > 5) return 'complex';
  if (nonEmptyLines > 50 || functions.length > 3 || classes.length > 1) return 'moderate';
  return 'simple';
}

function determineNodeType(filePath, fileCategory, language) {
  if (fileCategory === 'infra') {
    if (filePath.includes('Dockerfile') || filePath.includes('docker-compose') || filePath.includes('.docker')) return 'service';
    if (filePath.includes('.github/workflows') || filePath.includes('.gitlab-ci') || filePath.includes('Jenkinsfile')) return 'pipeline';
    if (filePath.endsWith('.tf') || filePath.includes('terraform')) return 'resource';
    return 'service';
  }
  if (fileCategory === 'data') {
    if (filePath.endsWith('.sql') || filePath.includes('migration')) return 'table';
    if (filePath.endsWith('.graphql') || filePath.endsWith('.proto') || filePath.endsWith('.prisma')) return 'schema';
    if (filePath.includes('openapi') || filePath.includes('swagger')) return 'endpoint';
    return 'table';
  }
  return CATEGORY_NODE_TYPE[fileCategory] || 'file';
}

// Main loop
let totalNodes = 0;
let totalEdges = 0;

for (const batch of batches) {
  const idx = batch.batchIndex;
  const files = batch.files;
  const batchImportData = batch.batchImportData || {};
  const neighborMap = batch.neighborMap || {};

  // Step A: write input JSON
  const inputPath = join(TMP, `ua-file-analyzer-input-${idx}.json`);
  const inputPayload = {
    projectRoot: PROJECT_ROOT,
    batchFiles: files.map(f => ({
      path: f.path,
      language: f.language || 'unknown',
      sizeLines: f.sizeLines || 1,
      fileCategory: f.fileCategory || 'code',
    })),
  };
  writeFileSync(inputPath, JSON.stringify(inputPayload, null, 2));

  // Step B: run extract-structure.mjs
  const extractResultsPath = join(TMP, `ua-file-extract-results-${idx}.json`);
  try {
    execSync(
      `node "${SKILL_DIR}/extract-structure.mjs" "${inputPath}" "${extractResultsPath}"`,
      { cwd: PROJECT_ROOT, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    const errMsg = e.stderr?.toString() || e.message;
    process.stderr.write(`Warning: extract-structure batch ${idx} failed: ${errMsg.slice(0, 200)}\n`);
    // Write an empty result for this batch
    writeFileSync(extractResultsPath, JSON.stringify({
      scriptCompleted: true, filesAnalyzed: 0, filesSkipped: [], results: []
    }));
  }

  // Step C: read results
  let extractResults;
  try {
    extractResults = JSON.parse(readFileSync(extractResultsPath, 'utf-8'));
  } catch {
    process.stderr.write(`Warning: batch ${idx} extract results unreadable, using empty\n`);
    extractResults = { scriptCompleted: true, filesAnalyzed: 0, filesSkipped: [], results: [] };
  }

  // Step D: build graph nodes and edges
  const nodes = [];
  const edges = [];
  const fileIdMap = new Map(); // path -> node id

  for (const result of extractResults.results || []) {
    const rPath = result.path;
    const rLang = result.language || 'unknown';
    const rCat = result.fileCategory || 'code';
    const nonEmpty = result.nonEmptyLines || result.totalLines || 1;
    const funcs = result.functions || [];
    const classes = result.classes || [];
    const exports = result.exports || [];

    const nodeType = determineNodeType(rPath, rCat, rLang);
    const nodeId = `${nodeType}:${rPath}`;
    fileIdMap.set(rPath, nodeId);

    const tags = guessTags(rPath, rCat, nonEmpty, exports, funcs, classes);
    const summary = guessSummary(rPath, rCat, nonEmpty, funcs, classes, exports);
    const complexity = guessComplexity(nonEmpty, funcs, classes);

    // File-level node
    nodes.push({
      id: nodeId,
      type: nodeType,
      name: rPath.split('/').pop(),
      filePath: rPath,
      summary,
      complexity,
      tags,
      language: rLang,
      sizeLines: result.totalLines || 1,
      nonEmptyLines: nonEmpty,
    });

    // Function nodes (significance filter)
    for (const fn of funcs) {
      const fnLines = (fn.endLine || 0) - (fn.startLine || 0) + 1;
      if (fnLines < 10 && !exports.some(e => e.name === fn.name)) continue;
      const fnId = `function:${rPath}:${fn.name}`;
      nodes.push({
        id: fnId,
        type: 'function',
        name: fn.name,
        filePath: rPath,
        summary: fn.params?.length ? `函数 ${fn.name}，接受 ${fn.params.join(', ')} 参数。` : `函数 ${fn.name}。`,
        complexity: fnLines > 50 ? 'moderate' : 'simple',
        tags: ['function'],
        startLine: fn.startLine,
        endLine: fn.endLine,
      });
      edges.push({ source: nodeId, target: fnId, type: 'contains', direction: 'forward', weight: 1.0 });
      if (exports.some(e => e.name === fn.name)) {
        edges.push({ source: nodeId, target: fnId, type: 'exports', direction: 'forward', weight: 0.8 });
      }
    }

    // Class nodes (significance filter)
    for (const cls of classes) {
      const clsLines = (cls.endLine || 0) - (cls.startLine || 0) + 1;
      const methodCount = (cls.methods || []).length;
      if (methodCount < 2 && clsLines < 20 && !exports.some(e => e.name === cls.name)) continue;
      const clsId = `class:${rPath}:${cls.name}`;
      nodes.push({
        id: clsId,
        type: 'class',
        name: cls.name,
        filePath: rPath,
        summary: `类 ${cls.name}，${(cls.properties || []).length > 0 ? `包含属性 ${cls.properties.join(', ')}，` : ''}定义了 ${methodCount} 个方法。`,
        complexity: clsLines > 200 ? 'complex' : clsLines > 50 ? 'moderate' : 'simple',
        tags: ['class'],
        startLine: cls.startLine,
        endLine: cls.endLine,
      });
      edges.push({ source: nodeId, target: clsId, type: 'contains', direction: 'forward', weight: 1.0 });
      if (exports.some(e => e.name === cls.name)) {
        edges.push({ source: nodeId, target: clsId, type: 'exports', direction: 'forward', weight: 0.8 });
      }
    }

    // Import edges from batchImportData
    const imports = batchImportData[rPath] || [];
    for (const impPath of imports) {
      const impType = impPath.includes('.test.') || impPath.includes('__tests__') ? 'test' : 'file';
      const impTarget = impPath.endsWith('.json') ? `config:${impPath}` : `${impType}:${impPath}`;
      edges.push({ source: nodeId, target: impTarget, type: 'imports', direction: 'forward', weight: 0.7 });
    }

    // tested_by edges (detect if this is a test file importing production)
    const isTest = rPath.includes('.test.') || rPath.includes('__tests__') || rPath.includes('.spec.');
    if (!isTest) {
      // This is a production file; check if any files import it (from cross-batch)
      for (const [neighborPath, neighborData] of Object.entries(neighborMap)) {
        const isNeighborTest = neighborPath.includes('.test.') || neighborPath.includes('__tests__') || neighborPath.includes('.spec.');
        if (isNeighborTest && Array.isArray(neighborData) && neighborData.some(n => n.path === rPath || n === rPath)) {
          edges.push({
            source: nodeId,
            target: `file:${neighborPath}`,
            type: 'tested_by',
            direction: 'forward',
            weight: 0.5,
          });
        }
      }
    }

    // Cross-batch neighbor edges (non-import structural hints)
    const neighbors = neighborMap[rPath] || [];
    for (const n of neighbors) {
      const nPath = typeof n === 'string' ? n : n.path;
      if (!nPath || fileIdMap.has(nPath)) continue; // same batch
      const nType = nPath.includes('.test.') || nPath.includes('__tests__') ? 'file' : 'file';
      edges.push({
        source: nodeId,
        target: `${nType}:${nPath}`,
        type: 'related',
        direction: 'forward',
        weight: 0.5,
      });
    }
  }

  // Collect skipped files and create basic nodes for them
  for (const skippedPath of extractResults.filesSkipped || []) {
    nodes.push({
      id: `file:${skippedPath}`,
      type: 'file',
      name: skippedPath.split('/').pop(),
      filePath: skippedPath,
      summary: `二进制/不可解析文件。`,
      complexity: 'simple',
      tags: ['binary'],
    });
  }

  // Step E: Write batch output
  const batchOutput = { nodes, edges };
  const outputPath = join(INTER, `batch-${idx}.json`);
  writeFileSync(outputPath, JSON.stringify(batchOutput, null, 2));

  totalNodes += nodes.length;
  totalEdges += edges.length;

  process.stderr.write(`Batch ${idx}: ${files.length} files, ${nodes.length} nodes, ${edges.length} edges\n`);
}

process.stderr.write(`\nTotal: ${totalNodes} nodes, ${totalEdges} edges across ${batches.length} batches\n`);
console.log(`Processed ${batches.length} batches`);
