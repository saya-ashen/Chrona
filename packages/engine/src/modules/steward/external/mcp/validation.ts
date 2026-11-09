type Row = Record<string, unknown>;
export const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (path: string) => Object.assign(new Error(`Invalid arguments at ${path}`), { code: "invalid" });
const unsupported = (path: string) => Object.assign(new Error(`Invalid arguments at ${path} (unsupported schema)`), { code: "invalid_schema" });
const equal = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  return a === b;
};
const annotations = new Set(["$schema", "$id", "$defs", "definitions", "title", "description", "default", "examples", "$comment", "deprecated", "readOnly", "writeOnly"]);
const supported = new Set(["type", "properties", "required", "additionalProperties", "enum", "const", "items", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minProperties", "maxProperties", "anyOf", "oneOf", "allOf", "not", "$ref"]);
function matches(schema: unknown, value: unknown, root: unknown, depth: number) {
  try { check(schema, value, "$", root, depth); return true; }
  catch (error) { if ((error as { code?: string }).code !== "invalid") throw error; return false; }
}
function checkComposition(schema: Row, value: unknown, path: string, root: unknown, depth: number) {
  for (const kind of ["anyOf", "oneOf", "allOf"] as const) if (schema[kind] !== undefined) {
    const branches = schema[kind];
    if (!Array.isArray(branches)) throw unsupported(path);
    const count = branches.filter(branch => matches(branch, value, root, depth + 1)).length;
    if (kind === "anyOf" ? count === 0 : kind === "oneOf" ? count !== 1 : count !== branches.length) throw invalid(path);
  }
  if (schema.not !== undefined && matches(schema.not, value, root, depth + 1)) throw invalid(path);
}
function checkType(type: unknown, value: unknown): boolean {
  switch (type) {
    case "null": return value === null;
    case "object": return object(value);
    case "array": return Array.isArray(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": case "boolean": return typeof value === type;
    default: throw unsupported("$.type");
  }
}
function checkString(schema: Row, value: string, path: string) {
  const length = [...value].length;
  if ((typeof schema.minLength === "number" && length < schema.minLength) || (typeof schema.maxLength === "number" && length > schema.maxLength)) throw invalid(path);
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) throw invalid(path);
}
function checkNumber(schema: Row, value: number, path: string) {
  const outside = [
    [schema.minimum, (limit: number) => value < limit], [schema.maximum, (limit: number) => value > limit],
    [schema.exclusiveMinimum, (limit: number) => value <= limit], [schema.exclusiveMaximum, (limit: number) => value >= limit],
    [schema.multipleOf, (limit: number) => !Number.isInteger(value / limit)],
  ] as const;
  if (!Number.isFinite(value) || outside.some(([limit, rejects]) => typeof limit === "number" && rejects(limit))) throw invalid(path);
}
function checkArray(schema: Row, value: unknown[], path: string, root: unknown, depth: number) {
  if ((typeof schema.minItems === "number" && value.length < schema.minItems) || (typeof schema.maxItems === "number" && value.length > schema.maxItems)) throw invalid(path);
  if (schema.uniqueItems === true && value.some((item, index) => value.slice(0, index).some(prior => equal(prior, item)))) throw invalid(path);
  if (schema.items !== undefined) value.forEach((item, index) => check(schema.items, item, `${path}[${index}]`, root, depth + 1));
}
function checkProperties(schema: Row, value: Row, path: string, root: unknown, depth: number) {
  const properties = object(schema.properties) ? schema.properties : {};
  for (const [key, item] of Object.entries(value)) {
    if (Object.hasOwn(properties, key)) check(properties[key], item, `${path}.${key}`, root, depth + 1);
    else if (schema.additionalProperties !== true) {
      if (!object(schema.additionalProperties)) throw invalid(`${path}.${key}`);
      check(schema.additionalProperties, item, `${path}.${key}`, root, depth + 1);
    }
  }
}
function checkObject(schema: Row, value: Row, path: string, root: unknown, depth: number) {
  const length = Object.keys(value).length;
  if ((typeof schema.minProperties === "number" && length < schema.minProperties) || (typeof schema.maxProperties === "number" && length > schema.maxProperties)) throw invalid(path);
  if (Array.isArray(schema.required) && schema.required.some(key => typeof key !== "string" || !Object.hasOwn(value, key))) throw invalid(path);
  // Object contracts are closed unless they explicitly declare an open map.
  if (["type", "properties", "additionalProperties"].some(key => Object.hasOwn(schema, key))) checkProperties(schema, value, path, root, depth);
}
function checkReference(ref: unknown, value: unknown, path: string, root: unknown, depth: number) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) throw unsupported(path);
  let resolved: unknown = root;
  for (const part of ref.slice(2).split("/")) resolved = object(resolved) ? resolved[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
  check(resolved, value, path, root, depth + 1);
}
function checkValues(schema: Row, value: unknown, path: string) {
  if (Object.hasOwn(schema, "const") && !equal(schema.const, value)) throw invalid(path);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.some(item => equal(item, value)))) throw invalid(path);
  if (schema.type !== undefined && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(type => checkType(type, value))) throw invalid(path);
}
function check(schema: unknown, value: unknown, path: string, root: unknown, depth: number): void {
  if (depth > 40) throw unsupported(path);
  if (schema === false) throw invalid(path);
  if (schema === true) return;
  if (!object(schema) || Object.keys(schema).some(key => !annotations.has(key) && !supported.has(key))) throw unsupported(path);
  if (schema.$ref !== undefined) checkReference(schema.$ref, value, path, root, depth);
  checkComposition(schema, value, path, root, depth);
  checkValues(schema, value, path);
  if (typeof value === "string") checkString(schema, value, path);
  if (typeof value === "number") checkNumber(schema, value, path);
  if (Array.isArray(value)) checkArray(schema, value, path, root, depth);
  if (object(value)) checkObject(schema, value, path, root, depth);
}
/** No coercion, defaults, stripping, remote refs or execution. Unsupported constraints fail closed. */
export function validate(schema: unknown, value: unknown): asserts value is Row {
  if (!object(value)) throw invalid("$");
  check(schema, value, "$", schema, 0);
}
