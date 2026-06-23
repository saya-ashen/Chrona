#!/usr/bin/env node
/**
 * Deterministic architecture layer inference from directory structure.
 * Reads assembled-graph.json, writes layers.json with layer assignments.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJ = process.argv[2] || '/home/saya/workspace/Chrona';
const INTER = join(PROJ, '.understand-anything/intermediate');

const graph = JSON.parse(readFileSync(join(INTER, 'assembled-graph.json'), 'utf-8'));

// Layer definitions by directory prefix (order matters - first match wins)
const LAYER_RULES = [
  { id: 'layer:cli', name: '命令行工具', description: 'CLI 入口和脚本工具', prefixes: ['packages/cli/', 'scripts/'] },
  { id: 'layer:web-frontend', name: 'Web 前端', description: 'React 前端应用 (Vite)', prefixes: ['apps/web/', 'e2e/'] },
  { id: 'layer:api-server', name: 'API 服务端', description: 'Hono API 服务器 (Bun)', prefixes: ['apps/server/'] },
  { id: 'layer:engine', name: '引擎层', description: '核心业务逻辑引擎', prefixes: ['packages/engine/'] },
  { id: 'layer:domain', name: '领域模型', description: '领域实体和业务规则', prefixes: ['packages/domain/'] },
  { id: 'layer:graph-runtime', name: '图运行时', description: '执行图运行时引擎', prefixes: ['packages/graph-runtime/'] },
  { id: 'layer:contracts', name: '合约定义', description: '类型定义和接口契约', prefixes: ['packages/contracts/'] },
  { id: 'layer:database', name: '数据库', description: '数据持久化和 Prisma 生成', prefixes: ['packages/db/'] },
  { id: 'layer:integrations', name: '集成层', description: '外部服务集成 (日历等)', prefixes: ['packages/integrations/'] },
  { id: 'layer:i18n', name: '国际化', description: '多语言消息和本地化', prefixes: ['packages/i18n/'] },
  { id: 'layer:shared', name: '共享工具', description: '跨包共享的通用工具函数', prefixes: ['packages/shared/'] },
  { id: 'layer:ui-protocol', name: 'UI 协议', description: 'UI 渲染协议和规范定义', prefixes: ['packages/ui-protocol/'] },
  { id: 'layer:infrastructure', name: '基础设施', description: 'CI/CD、容器化和部署配置', prefixes: ['.github/', 'Dockerfile', 'docker-compose'] },
  { id: 'layer:project-config', name: '项目配置', description: '项目根级别配置文件', prefixes: ['package.json', 'tsconfig', 'eslint', 'vite.config', 'vitest.config', 'postcss', 'tailwind'] },
  { id: 'layer:documentation', name: '文档', description: '项目文档和设计说明', prefixes: ['docs/', 'README', 'CONTRIBUTING', 'DESIGN', 'PRODUCT'] },
  { id: 'layer:development', name: '开发工具', description: '开发环境和辅助工具', prefixes: ['.claude/', '.specify/', '.omc/', '.impeccable/', '.vscode/'] },
  { id: 'layer:prisma', name: 'Prisma ORM', description: 'Prisma 数据模型和迁移', prefixes: ['prisma/'] },
];

// Assign nodes to layers
const layerMap = new Map(); // layerId -> { layerDef, nodeIds: Set }
for (const rule of LAYER_RULES) {
  layerMap.set(rule.id, { ...rule, nodeIds: new Set() });
}
const unassigned = [];

for (const node of graph.nodes) {
  const fp = node.filePath || '';
  let assigned = false;
  for (const [lid, layer] of layerMap) {
    if (layer.prefixes.some(p => fp.startsWith(p) || fp.includes(p))) {
      layer.nodeIds.add(node.id);
      assigned = true;
      break;
    }
  }
  if (!assigned) unassigned.push(node.id);
}

// Put unassigned into catch-all
if (unassigned.length > 0) {
  layerMap.set('layer:other', {
    id: 'layer:other',
    name: '其他',
    description: '未归类到特定层的文件',
    nodeIds: new Set(unassigned),
  });
}

const layers = [];
for (const [, layer] of layerMap) {
  if (layer.nodeIds.size > 0) {
    layers.push({
      id: layer.id,
      name: layer.name,
      description: layer.description,
      nodeIds: [...layer.nodeIds].sort(),
    });
  }
}

writeFileSync(join(INTER, 'layers.json'), JSON.stringify(layers, null, 2));
console.log(`Layers: ${layers.length}, total nodeIds: ${layers.reduce((s, l) => s + l.nodeIds.length, 0)}`);
console.log(`Unassigned nodes: ${unassigned.length > 0 ? unassigned.length : '0 (all assigned)'}`);
process.stderr.write(`Warning: Unassigned nodes: ${unassigned.length}\n`);
