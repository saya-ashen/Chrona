import { z } from "zod";

// App-owned templates are expanded before the ordinary catalog/tool validation.
// No browser code, extra authority or private state is introduced by a template.
type Args = Record<string, unknown>;
export type PageElement = { type: string; props?: Args; children?: string[]; slots?: Record<string, string[]>; on?: Record<string, unknown>; [key: string]: unknown };
export type PageSpec = { root: string; elements: Record<string, PageElement>; state?: Args };
const record = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);
function invalid(message: string): never { throw Object.assign(new Error(`组合组件无效：${message}`), { code: "invalid" }); }
const elementSchema = z.object({ type: z.string(), props: z.record(z.string(), z.unknown()).optional(), children: z.array(z.string()).optional(), slots: z.record(z.string(), z.array(z.string())).optional(), on: z.record(z.string(), z.unknown()).optional() }).passthrough();
const specSchema = z.object({ root: z.string(), elements: z.record(z.string(), elementSchema), state: z.record(z.string(), z.unknown()).optional() }).strict();
const definitionSchema = z.object({
  props: z.object({ type: z.literal("object"), properties: z.record(z.string(), z.record(z.string(), z.unknown())), required: z.array(z.string()).optional(), additionalProperties: z.literal(false) }).strict(),
  events: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/)).max(16).default([]),
  slots: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/)).max(16).default([]),
  spec: specSchema.omit({ state: true }),
}).strict();
type Definition = z.infer<typeof definitionSchema>;
const expression = (value: unknown) => record(value) && Object.keys(value).some(key => key.startsWith("$"));

function definitions(raw: unknown, module: string) {
  if (raw === undefined) return new Map<string, Definition>();
  if (!record(raw) || Object.keys(raw).length > 16) invalid("每页最多 16 个定义");
  const result = new Map<string, Definition>();
  for (const [name, value] of Object.entries(raw)) {
    if (!name.startsWith(`${module}:`) || !/^[A-Z][a-zA-Z0-9]{0,40}$/.test(name.slice(module.length + 1))) invalid(`名称 ${name} 必须使用 ${module}:Name`);
    const parsed = definitionSchema.safeParse(value);
    if (!parsed.success) invalid(`${name} 的 props、events、slots 或 spec 格式无效`);
    const definition = parsed.data;
    if (!Object.hasOwn(definition.spec.elements, definition.spec.root)) invalid(`${name} 缺少根节点`);
    if (Object.keys(definition.spec.elements).length > 100) invalid(`${name} 最多 100 个模板节点`);
    result.set(name, definition);
  }
  return result;
}
function checkProps(name: string, definition: Definition, props: Args) {
  const shape = definition.props.properties;
  for (const key of Object.keys(props)) if (!Object.hasOwn(shape, key)) invalid(`${name} 没有属性 ${key}`);
  for (const key of definition.props.required ?? []) if (props[key] === undefined) invalid(`${name} 缺少属性 ${key}`);
  for (const [key, value] of Object.entries(props)) {
    if (expression(value)) continue;
    let schema: z.ZodType;
    try { schema = z.fromJSONSchema(shape[key]! as Parameters<typeof z.fromJSONSchema>[0]); }
    catch { invalid(`${name}.${key} 的属性契约不受支持`); }
    if (!schema.safeParse(value).success) invalid(`${name}.${key} 不符合属性契约`);
  }
}
function checkInstance(name: string, definition: Definition, node: PageElement) {
  checkProps(name, definition, node.props ?? {});
  for (const event of Object.keys(node.on ?? {})) if (!definition.events.includes(event)) invalid(`${name} 没有事件 ${event}`);
  for (const slot of Object.keys(node.slots ?? {})) if (!definition.slots.includes(slot)) invalid(`${name} 没有插槽 ${slot}`);
  if (node.children?.length && !definition.slots.includes("default")) invalid(`${name} 没有 default 插槽`);
}
function substitute(value: unknown, instance: PageElement, definition: Definition): unknown {
  if (Array.isArray(value)) return value.map(item => substitute(item, instance, definition));
  if (!record(value)) return value;
  if (Object.keys(value).length === 1 && typeof value.$prop === "string") {
    if (!Object.hasOwn(definition.props.properties, value.$prop)) invalid(`未声明的属性 ${value.$prop}`);
    return instance.props?.[value.$prop];
  }
  if (Object.keys(value).length === 1 && typeof value.$event === "string") {
    if (!definition.events.includes(value.$event)) invalid(`未声明的事件 ${value.$event}`);
    return instance.on?.[value.$event] ?? [];
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, instance, definition)]).filter(([, item]) => item !== undefined));
}
function templateVisibility(node: PageElement) {
  // Boolean prop expressions are not visibility conditions. Lower a boolean
  // flag to its public condition while keeping the surrounding repeat scope.
  if (record(node.visible) && Object.hasOwn(node.visible, "$cond") && node.visible.$then === true && node.visible.$else === false) node.visible = node.visible.$cond;
}
function slotTargets(ref: string, names: Map<string, string>, definition: Definition, node: PageElement) {
  if (!ref.startsWith("$slot:")) return [names.get(ref) ?? invalid(`模板节点 ${ref} 不存在`)];
  const slot = ref.slice(6);
  if (!definition.slots.includes(slot)) invalid(`未声明的插槽 ${slot}`);
  return node.slots?.[slot] ?? (slot === "default" ? node.children ?? [] : []);
}
function assertGraph(spec: PageSpec) {
  const active = new Set<string>(), done = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) invalid(`节点循环引用 ${key}`);
    if (done.has(key)) return;
    if (!Object.hasOwn(spec.elements, key)) invalid(`节点 ${key} 不存在`);
    const node = spec.elements[key]!;
    active.add(key);
    for (const child of [...node.children ?? [], ...Object.values(node.slots ?? {}).flat()]) visit(child);
    active.delete(key); done.add(key);
  };
  visit(spec.root);
}

export function expandComponents(raw: unknown, components: unknown, module: string): PageSpec {
  // Structural details are still checked by the shared catalog after expansion.
  const parsed = specSchema.safeParse(raw);
  if (!parsed.success) invalid("需要合法的 spec.root、spec.elements 和可选 state");
  const source = parsed.data as PageSpec, templates = definitions(components, module);
  const elements: Record<string, PageElement> = Object.create(null), occupied = new Set(Object.keys(source.elements));
  let serial = 0, references = 0, bytes = 0;
  const sizes = new Map<string, number>();
  const fresh = () => { let key: string; do { key = `__component_${++serial}`; } while (occupied.has(key)); occupied.add(key); return key; };
  const put = (key: string, node: PageElement) => {
    if (!Object.hasOwn(elements, key) && Object.keys(elements).length >= 300) invalid("展开后最多 300 个节点");
    const size = Buffer.byteLength(JSON.stringify(node));
    bytes += size - (sizes.get(key) ?? 0);
    if (bytes > 65_536) invalid("展开后的页面最多 64 KiB");
    sizes.set(key, size); elements[key] = node;
  };
  const expand = (key: string, node: PageElement, chain: string[]) => {
    if (!record(node) || typeof node.type !== "string") invalid(`节点 ${key} 格式无效`);
    const definition = templates.get(node.type);
    if (!definition) { put(key, node); return; }
    if (chain.includes(node.type) || chain.length >= 8) invalid(`递归或嵌套过深：${node.type}`);
    checkInstance(node.type, definition, node);
    const names = new Map(Object.keys(definition.spec.elements).map(name => [name, name === definition.spec.root && !node.repeat ? key : fresh()]));
    const children = (refs: string[]) => {
      const result: string[] = [];
      for (const ref of refs) {
        const targets = slotTargets(ref, names, definition, node);
        // Charge before copying: slot forwarding can multiply edges without
        // introducing distinct nodes, well before the final byte/node check.
        references += targets.length;
        if (references > 4096) invalid("展开过程最多 4096 个子节点引用");
        result.push(...targets);
      }
      return result;
    };
    for (const [name, template] of Object.entries(definition.spec.elements)) {
      const next = substitute(template, node, definition) as PageElement;
      templateVisibility(next);
      next.children = children(next.children ?? []);
      if (next.slots) next.slots = Object.fromEntries(Object.entries(next.slots).map(([slot, refs]) => [slot, children(refs)]));
      expand(names.get(name)!, next, [...chain, node.type]);
    }
    // The wrapper owns visibility/repetition. Its descendants see the repeat's
    // item scope, including expressions passed as component props and callbacks.
    const { type: _, props: __, children: ___, slots: ____, on: _____, ...controls } = node;
    if (node.repeat) put(key, { type: "Stack", props: { gap: "none" }, ...controls, children: [names.get(definition.spec.root)!] });
    else {
      const root = elements[key]!;
      put(key, { ...root, ...controls, ...(root.visible !== undefined && controls.visible !== undefined ? { visible: { $and: [root.visible, controls.visible] } } : {}) });
    }
  };
  for (const [key, node] of Object.entries(source.elements)) expand(key, node, []);
  const result = { ...source, elements };
  assertGraph(result);
  return result;
}
