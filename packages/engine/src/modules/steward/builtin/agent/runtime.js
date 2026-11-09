// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// packages/engine/src/modules/steward/builtin/agent/runtime.ts
import { randomUUID as randomUUID3 } from "crypto";

// node_modules/zod/v4/core/core.js
var _a;
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}

// node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/zod/v4/core/regexes.js
var exports_regexes = {};
__export(exports_regexes, {
  base64: () => base64,
  base64url: () => base64url,
  bigint: () => bigint,
  boolean: () => boolean,
  browserEmail: () => browserEmail,
  cidrv4: () => cidrv4,
  cidrv6: () => cidrv6,
  cuid: () => cuid,
  cuid2: () => cuid2,
  date: () => date,
  datetime: () => datetime,
  domain: () => domain,
  duration: () => duration,
  e164: () => e164,
  email: () => email,
  emoji: () => emoji,
  extendedDuration: () => extendedDuration,
  guid: () => guid,
  hex: () => hex,
  hostname: () => hostname,
  html5Email: () => html5Email,
  httpProtocol: () => httpProtocol,
  idnEmail: () => idnEmail,
  integer: () => integer,
  ipv4: () => ipv4,
  ipv6: () => ipv6,
  ksuid: () => ksuid,
  lowercase: () => lowercase,
  mac: () => mac,
  md5_base64: () => md5_base64,
  md5_base64url: () => md5_base64url,
  md5_hex: () => md5_hex,
  nanoid: () => nanoid,
  null: () => _null,
  number: () => number,
  rfc5322Email: () => rfc5322Email,
  sha1_base64: () => sha1_base64,
  sha1_base64url: () => sha1_base64url,
  sha1_hex: () => sha1_hex,
  sha256_base64: () => sha256_base64,
  sha256_base64url: () => sha256_base64url,
  sha256_hex: () => sha256_hex,
  sha384_base64: () => sha384_base64,
  sha384_base64url: () => sha384_base64url,
  sha384_hex: () => sha384_hex,
  sha512_base64: () => sha512_base64,
  sha512_base64url: () => sha512_base64url,
  sha512_hex: () => sha512_hex,
  string: () => string,
  time: () => time,
  ulid: () => ulid,
  undefined: () => _undefined,
  unicodeEmail: () => unicodeEmail,
  uppercase: () => uppercase,
  uuid: () => uuid,
  uuid4: () => uuid4,
  uuid6: () => uuid6,
  uuid7: () => uuid7,
  xid: () => xid
});
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var uuid4 = /* @__PURE__ */ uuid(4);
var uuid6 = /* @__PURE__ */ uuid(6);
var uuid7 = /* @__PURE__ */ uuid(7);
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
var unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
var idnEmail = unicodeEmail;
var browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var mac = (delimiter) => {
  const escapedDelim = escapeRegex(delimiter ?? ":");
  return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
};
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var domain = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var bigint = /^-?\d+n?$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var _null = /^null$/i;
var _undefined = /^undefined$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
var hex = /^[0-9a-fA-F]*$/;
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var md5_hex = /^[0-9a-fA-F]{32}$/;
var md5_base64 = /* @__PURE__ */ fixedBase64(22, "==");
var md5_base64url = /* @__PURE__ */ fixedBase64url(22);
var sha1_hex = /^[0-9a-fA-F]{40}$/;
var sha1_base64 = /* @__PURE__ */ fixedBase64(27, "=");
var sha1_base64url = /* @__PURE__ */ fixedBase64url(27);
var sha256_hex = /^[0-9a-fA-F]{64}$/;
var sha256_base64 = /* @__PURE__ */ fixedBase64(43, "=");
var sha256_base64url = /* @__PURE__ */ fixedBase64url(43);
var sha384_hex = /^[0-9a-fA-F]{96}$/;
var sha384_base64 = /* @__PURE__ */ fixedBase64(64, "");
var sha384_base64url = /* @__PURE__ */ fixedBase64url(64);
var sha512_hex = /^[0-9a-fA-F]{128}$/;
var sha512_base64 = /* @__PURE__ */ fixedBase64(86, "==");
var sha512_base64url = /* @__PURE__ */ fixedBase64url(86);

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    var _a;
    (_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckBigIntFormat = /* @__PURE__ */ $constructor("$ZodCheckBigIntFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  const [minimum, maximum] = BIGINT_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input < minimum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxSize = /* @__PURE__ */ $constructor("$ZodCheckMaxSize", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size <= def.maximum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinSize = /* @__PURE__ */ $constructor("$ZodCheckMinSize", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size >= def.minimum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckSizeEquals = /* @__PURE__ */ $constructor("$ZodCheckSizeEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.size;
    bag.maximum = def.size;
    bag.size = def.size;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size === def.size)
      return;
    const tooBig = size > def.size;
    payload.issues.push({
      origin: getSizableOrigin(input),
      ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
var $ZodCheckProperty = /* @__PURE__ */ $constructor("$ZodCheckProperty", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    const result = def.schema._zod.run({
      value: payload.value[def.property],
      issues: []
    }, {});
    if (result instanceof Promise) {
      return result.then((result) => handleCheckPropertyResult(result, payload, def.property));
    }
    handleCheckPropertyResult(result, payload, def.property);
    return;
  };
});
var $ZodCheckMimeType = /* @__PURE__ */ $constructor("$ZodCheckMimeType", (inst, def) => {
  $ZodCheck.init(inst, def);
  const mimeSet = new Set(def.mime);
  inst._zod.onattach.push((inst) => {
    inst._zod.bag.mime = def.mime;
  });
  inst._zod.check = (payload) => {
    if (mimeSet.has(payload.value.type))
      return;
    payload.issues.push({
      code: "invalid_value",
      values: def.mime,
      input: payload.value.type,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodMAC = /* @__PURE__ */ $constructor("$ZodMAC", (inst, def) => {
  def.pattern ?? (def.pattern = mac(def.delimiter));
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `mac`;
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error;
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCustomStringFormat = /* @__PURE__ */ $constructor("$ZodCustomStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (def.fn(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: def.format,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = bigint;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = BigInt(payload.value);
      } catch (_) {}
    if (typeof payload.value === "bigint")
      return payload;
    payload.issues.push({
      expected: "bigint",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodBigIntFormat = /* @__PURE__ */ $constructor("$ZodBigIntFormat", (inst, def) => {
  $ZodCheckBigIntFormat.init(inst, def);
  $ZodBigInt.init(inst, def);
});
var $ZodSymbol = /* @__PURE__ */ $constructor("$ZodSymbol", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "symbol")
      return payload;
    payload.issues.push({
      expected: "symbol",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUndefined = /* @__PURE__ */ $constructor("$ZodUndefined", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _undefined;
  inst._zod.values = new Set([undefined]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "undefined",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodAny = /* @__PURE__ */ $constructor("$ZodAny", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodVoid = /* @__PURE__ */ $constructor("$ZodVoid", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "void",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodDate = /* @__PURE__ */ $constructor("$ZodDate", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce) {
      try {
        payload.value = new Date(payload.value);
      } catch (_err) {}
    }
    const input = payload.value;
    const isDate = input instanceof Date;
    const isValidDate = isDate && !Number.isNaN(input.getTime());
    if (isValidDate)
      return payload;
    payload.issues.push({
      expected: "date",
      code: "invalid_type",
      input,
      ...isDate ? { received: "Invalid Date" } : {},
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }

        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }

        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
function handleExclusiveUnionResults(results, final, inst, ctx) {
  const successes = results.filter((r) => r.issues.length === 0);
  if (successes.length === 1) {
    final.value = successes[0].value;
    return final;
  }
  if (successes.length === 0) {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
    });
  } else {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: [],
      inclusive: false
    });
  }
  return final;
}
var $ZodXor = /* @__PURE__ */ $constructor("$ZodXor", (inst, def) => {
  $ZodUnion.init(inst, def);
  def.inclusive = false;
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        results.push(result);
      }
    }
    if (!async)
      return handleExclusiveUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleExclusiveUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = new Set;
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map = new Map;
    for (const o of opts) {
      const values = o._zod.propValues?.[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map.set(v, o);
      }
    }
    return map;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
  $ZodType.init(inst, def);
  const items = def.items;
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        input,
        inst,
        expected: "tuple",
        code: "invalid_type"
      });
      return payload;
    }
    payload.value = [];
    const proms = [];
    const optinStart = getTupleOptStart(items, "optin");
    const optoutStart = getTupleOptStart(items, "optout");
    if (!def.rest) {
      if (input.length < optinStart) {
        payload.issues.push({
          code: "too_small",
          minimum: optinStart,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
        return payload;
      }
      if (input.length > items.length) {
        payload.issues.push({
          code: "too_big",
          maximum: items.length,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
      }
    }
    const itemResults = new Array(items.length);
    for (let i = 0;i < items.length; i++) {
      const r = items[i]._zod.run({ value: input[i], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((rr) => {
          itemResults[i] = rr;
        }));
      } else {
        itemResults[i] = r;
      }
    }
    if (def.rest) {
      let i = items.length - 1;
      const rest = input.slice(items.length);
      for (const el of rest) {
        i++;
        const result = def.rest._zod.run({ value: el, issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((r) => handleTupleResult(r, payload, i)));
        } else {
          handleTupleResult(result, payload, i);
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
    }
    return handleTupleResults(itemResults, payload, items, input, optoutStart);
  };
});
function getTupleOptStart(items, key) {
  for (let i = items.length - 1;i >= 0; i--) {
    if (items[i]._zod[key] !== "optional")
      return i + 1;
  }
  return 0;
}
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input, optoutStart) {
  for (let i = 0;i < items.length; i++) {
    const r = itemResults[i];
    const isPresent = i < input.length;
    if (r.issues.length) {
      if (!isPresent && i >= optoutStart) {
        final.value.length = i;
        break;
      }
      final.issues.push(...prefixIssues(i, r.issues));
    }
    final.value[i] = r.value;
  }
  for (let i = final.value.length - 1;i >= input.length; i--) {
    if (items[i]._zod.optout === "optional" && final.value[i] === undefined) {
      final.value.length = i;
    } else {
      break;
    }
  }
  return final;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result) => {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[keyResult.value] = result.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodMap = /* @__PURE__ */ $constructor("$ZodMap", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Map)) {
      payload.issues.push({
        expected: "map",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    payload.value = new Map;
    for (const [key, value] of input) {
      const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
      const valueResult = def.valueType._zod.run({ value, issues: [] }, ctx);
      if (keyResult instanceof Promise || valueResult instanceof Promise) {
        proms.push(Promise.all([keyResult, valueResult]).then(([keyResult, valueResult]) => {
          handleMapResult(keyResult, valueResult, payload, key, input, inst, ctx);
        }));
      } else {
        handleMapResult(keyResult, valueResult, payload, key, input, inst, ctx);
      }
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleMapResult(keyResult, valueResult, final, key, input, inst, ctx) {
  if (keyResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, keyResult.issues));
    } else {
      final.issues.push({
        code: "invalid_key",
        origin: "map",
        input,
        inst,
        issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  if (valueResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, valueResult.issues));
    } else {
      final.issues.push({
        origin: "map",
        code: "invalid_element",
        input,
        inst,
        key,
        issues: valueResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  final.value.set(keyResult.value, valueResult.value);
}
var $ZodSet = /* @__PURE__ */ $constructor("$ZodSet", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Set)) {
      payload.issues.push({
        input,
        inst,
        expected: "set",
        code: "invalid_type"
      });
      return payload;
    }
    const proms = [];
    payload.value = new Set;
    for (const item of input) {
      const result = def.valueType._zod.run({ value: item, issues: [] }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleSetResult(result, payload)));
      } else
        handleSetResult(result, payload);
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleSetResult(result, final) {
  if (result.issues.length) {
    final.issues.push(...result.issues);
  }
  final.value.add(result.value);
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodFile = /* @__PURE__ */ $constructor("$ZodFile", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input instanceof File)
      return payload;
    payload.issues.push({
      expected: "file",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === undefined && (result.issues.length || result.fallback)) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodSuccess = /* @__PURE__ */ $constructor("$ZodSuccess", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError("ZodSuccess");
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => {
        payload.value = result.issues.length === 0;
        return payload;
      });
    }
    payload.value = result.issues.length === 0;
    return payload;
  };
});
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => {
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodNaN = /* @__PURE__ */ $constructor("$ZodNaN", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "number" || !Number.isNaN(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "nan",
        code: "invalid_type"
      });
      return payload;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodCodec = /* @__PURE__ */ $constructor("$ZodCodec", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    const direction = ctx.direction || "forward";
    if (direction === "forward") {
      const left = def.in._zod.run(payload, ctx);
      if (left instanceof Promise) {
        return left.then((left) => handleCodecAResult(left, def, ctx));
      }
      return handleCodecAResult(left, def, ctx);
    } else {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handleCodecAResult(right, def, ctx));
      }
      return handleCodecAResult(right, def, ctx);
    }
  };
});
function handleCodecAResult(result, def, ctx) {
  if (result.issues.length) {
    result.aborted = true;
    return result;
  }
  const direction = ctx.direction || "forward";
  if (direction === "forward") {
    const transformed = def.transform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.out, ctx));
    }
    return handleCodecTxResult(result, transformed, def.out, ctx);
  } else {
    const transformed = def.reverseTransform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.in, ctx));
    }
    return handleCodecTxResult(result, transformed, def.in, ctx);
  }
}
function handleCodecTxResult(left, value, nextSchema, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return nextSchema._zod.run({ value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodTemplateLiteral = /* @__PURE__ */ $constructor("$ZodTemplateLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const regexParts = [];
  for (const part of def.parts) {
    if (typeof part === "object" && part !== null) {
      if (!part._zod.pattern) {
        throw new Error(`Invalid template literal part, no pattern found: ${[...part._zod.traits].shift()}`);
      }
      const source = part._zod.pattern instanceof RegExp ? part._zod.pattern.source : part._zod.pattern;
      if (!source)
        throw new Error(`Invalid template literal part: ${part._zod.traits}`);
      const start = source.startsWith("^") ? 1 : 0;
      const end = source.endsWith("$") ? source.length - 1 : source.length;
      regexParts.push(source.slice(start, end));
    } else if (part === null || primitiveTypes.has(typeof part)) {
      regexParts.push(escapeRegex(`${part}`));
    } else {
      throw new Error(`Invalid template literal part: ${part}`);
    }
  }
  inst._zod.pattern = new RegExp(`^${regexParts.join("")}$`);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "string") {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "string",
        code: "invalid_type"
      });
      return payload;
    }
    inst._zod.pattern.lastIndex = 0;
    if (!inst._zod.pattern.test(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        code: "invalid_format",
        format: def.format ?? "template_literal",
        pattern: inst._zod.pattern.source
      });
      return payload;
    }
    return payload;
  };
});
var $ZodFunction = /* @__PURE__ */ $constructor("$ZodFunction", (inst, def) => {
  $ZodType.init(inst, def);
  inst._def = def;
  inst._zod.def = def;
  inst.implement = (func) => {
    if (typeof func !== "function") {
      throw new Error("implement() must be called with a function");
    }
    return function(...args) {
      const parsedArgs = inst._def.input ? parse(inst._def.input, args) : args;
      const result = Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return parse(inst._def.output, result);
      }
      return result;
    };
  };
  inst.implementAsync = (func) => {
    if (typeof func !== "function") {
      throw new Error("implementAsync() must be called with a function");
    }
    return async function(...args) {
      const parsedArgs = inst._def.input ? await parseAsync(inst._def.input, args) : args;
      const result = await Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return await parseAsync(inst._def.output, result);
      }
      return result;
    };
  };
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "function") {
      payload.issues.push({
        code: "invalid_type",
        expected: "function",
        input: payload.value,
        inst
      });
      return payload;
    }
    const hasPromiseOutput = inst._def.output && inst._def.output._zod.def.type === "promise";
    if (hasPromiseOutput) {
      payload.value = inst.implementAsync(payload.value);
    } else {
      payload.value = inst.implement(payload.value);
    }
    return payload;
  };
  inst.input = (...args) => {
    const F = inst.constructor;
    if (Array.isArray(args[0])) {
      return new F({
        type: "function",
        input: new $ZodTuple({
          type: "tuple",
          items: args[0],
          rest: args[1]
        }),
        output: inst._def.output
      });
    }
    return new F({
      type: "function",
      input: args[0],
      output: inst._def.output
    });
  };
  inst.output = (output) => {
    const F = inst.constructor;
    return new F({
      type: "function",
      input: inst._def.input,
      output
    });
  };
  return inst;
});
var $ZodPromise = /* @__PURE__ */ $constructor("$ZodPromise", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    return Promise.resolve(payload.value).then((inner) => def.innerType._zod.run({ value: inner, issues: [] }, ctx));
  };
});
var $ZodLazy = /* @__PURE__ */ $constructor("$ZodLazy", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "innerType", () => {
    const d = def;
    if (!d._cachedInner)
      d._cachedInner = def.getter();
    return d._cachedInner;
  });
  defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
  defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
  defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? undefined);
  defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? undefined);
  inst._zod.parse = (payload, ctx) => {
    const inner = inst._zod.innerType;
    return inner._zod.run(payload, ctx);
  };
});
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue.expected] ?? issue.expected;
        const receivedType = parsedType(issue.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        const adj = issue.inclusive ? "<=" : "<";
        const sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue.inclusive ? ">=" : ">";
        const sizing = getSizing(issue.origin);
        if (sizing) {
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
          const opts = issue.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/zod/v4/core/api.js
function _string(Class, params) {
  return new Class({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _mac(Class, params) {
  return new Class({
    type: "string",
    format: "mac",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _float32(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float32",
    ...normalizeParams(params)
  });
}
function _float64(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float64",
    ...normalizeParams(params)
  });
}
function _int32(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "int32",
    ...normalizeParams(params)
  });
}
function _uint32(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "uint32",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _bigint(Class, params) {
  return new Class({
    type: "bigint",
    ...normalizeParams(params)
  });
}
function _int64(Class, params) {
  return new Class({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "int64",
    ...normalizeParams(params)
  });
}
function _uint64(Class, params) {
  return new Class({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "uint64",
    ...normalizeParams(params)
  });
}
function _symbol(Class, params) {
  return new Class({
    type: "symbol",
    ...normalizeParams(params)
  });
}
function _undefined2(Class, params) {
  return new Class({
    type: "undefined",
    ...normalizeParams(params)
  });
}
function _null2(Class, params) {
  return new Class({
    type: "null",
    ...normalizeParams(params)
  });
}
function _any(Class) {
  return new Class({
    type: "any"
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _void(Class, params) {
  return new Class({
    type: "void",
    ...normalizeParams(params)
  });
}
function _date(Class, params) {
  return new Class({
    type: "date",
    ...normalizeParams(params)
  });
}
function _nan(Class, params) {
  return new Class({
    type: "nan",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _positive(params) {
  return _gt(0, params);
}
function _negative(params) {
  return _lt(0, params);
}
function _nonpositive(params) {
  return _lte(0, params);
}
function _nonnegative(params) {
  return _gte(0, params);
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxSize(maximum, params) {
  return new $ZodCheckMaxSize({
    check: "max_size",
    ...normalizeParams(params),
    maximum
  });
}
function _minSize(minimum, params) {
  return new $ZodCheckMinSize({
    check: "min_size",
    ...normalizeParams(params),
    minimum
  });
}
function _size(size, params) {
  return new $ZodCheckSizeEquals({
    check: "size_equals",
    ...normalizeParams(params),
    size
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _property(property, schema, params) {
  return new $ZodCheckProperty({
    check: "property",
    property,
    schema,
    ...normalizeParams(params)
  });
}
function _mime(types, params) {
  return new $ZodCheckMimeType({
    check: "mime_type",
    mime: types,
    ...normalizeParams(params)
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _file(Class, params) {
  return new Class({
    type: "file",
    ...normalizeParams(params)
  });
}
function _custom(Class, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
function describe(description) {
  const ch = new $ZodCheck({ check: "describe" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, description });
    }
  ];
  ch._zod.check = () => {};
  return ch;
}
function meta(metadata) {
  const ch = new $ZodCheck({ check: "meta" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, ...metadata });
    }
  ];
  ch._zod.check = () => {};
  return ch;
}
function _stringbool(Classes, _params) {
  const params = normalizeParams(_params);
  let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
  let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
  if (params.case !== "sensitive") {
    truthyArray = truthyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
    falsyArray = falsyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
  }
  const truthySet = new Set(truthyArray);
  const falsySet = new Set(falsyArray);
  const _Codec = Classes.Codec ?? $ZodCodec;
  const _Boolean = Classes.Boolean ?? $ZodBoolean;
  const _String = Classes.String ?? $ZodString;
  const stringSchema = new _String({ type: "string", error: params.error });
  const booleanSchema = new _Boolean({ type: "boolean", error: params.error });
  const codec = new _Codec({
    type: "pipe",
    in: stringSchema,
    out: booleanSchema,
    transform: (input, payload) => {
      let data = input;
      if (params.case !== "sensitive")
        data = data.toLowerCase();
      if (truthySet.has(data)) {
        return true;
      } else if (falsySet.has(data)) {
        return false;
      } else {
        payload.issues.push({
          code: "invalid_value",
          expected: "stringbool",
          values: [...truthySet, ...falsySet],
          input: payload.value,
          inst: codec,
          continue: false
        });
        return {};
      }
    },
    reverseTransform: (input, _payload) => {
      if (input === true) {
        return truthyArray[0] || "true";
      } else {
        return falsyArray[0] || "false";
      }
    },
    error: params.error
  });
  return codec;
}
function _stringFormat(Class, format, fnOrRegex, _params = {}) {
  const params = normalizeParams(_params);
  const def = {
    ...normalizeParams(_params),
    check: "string_format",
    type: "string",
    format,
    fn: typeof fnOrRegex === "function" ? fnOrRegex : (val) => fnOrRegex.test(val),
    ...params
  };
  if (fnOrRegex instanceof RegExp) {
    def.pattern = fnOrRegex;
  }
  const inst = new Class(def);
  return inst;
}
// node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? undefined
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        Object.assign(schema, refSchema);
      }
      Object.assign(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var bigintProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("BigInt cannot be represented in JSON Schema");
  }
};
var symbolProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Symbols cannot be represented in JSON Schema");
  }
};
var nullProcessor = (_schema, ctx, json, _params) => {
  if (ctx.target === "openapi-3.0") {
    json.type = "string";
    json.nullable = true;
    json.enum = [null];
  } else {
    json.type = "null";
  }
};
var undefinedProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Undefined cannot be represented in JSON Schema");
  }
};
var voidProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Void cannot be represented in JSON Schema");
  }
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var anyProcessor = (_schema, _ctx, _json, _params) => {};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var dateProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Date cannot be represented in JSON Schema");
  }
};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var nanProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("NaN cannot be represented in JSON Schema");
  }
};
var templateLiteralProcessor = (schema, _ctx, json, _params) => {
  const _json = json;
  const pattern = schema._zod.pattern;
  if (!pattern)
    throw new Error("Pattern not found in template literal");
  _json.type = "string";
  _json.pattern = pattern.source;
};
var fileProcessor = (schema, _ctx, json, _params) => {
  const _json = json;
  const file = {
    type: "string",
    format: "binary",
    contentEncoding: "binary"
  };
  const { minimum, maximum, mime } = schema._zod.bag;
  if (minimum !== undefined)
    file.minLength = minimum;
  if (maximum !== undefined)
    file.maxLength = maximum;
  if (mime) {
    if (mime.length === 1) {
      file.contentMediaType = mime[0];
      Object.assign(_json, file);
    } else {
      Object.assign(_json, file);
      _json.anyOf = mime.map((m) => ({ contentMediaType: m }));
    }
  } else {
    Object.assign(_json, file);
  }
};
var successProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var functionProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Function types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var mapProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Map cannot be represented in JSON Schema");
  }
};
var setProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Set cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === undefined;
    } else {
      return v.optout === undefined;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var tupleProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "array";
  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
  const prefixItems = def.items.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, prefixPath, i]
  }));
  const rest = def.rest ? process2(def.rest, ctx, {
    ...params,
    path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
  }) : null;
  if (ctx.target === "draft-2020-12") {
    json.prefixItems = prefixItems;
    if (rest) {
      json.items = rest;
    }
  } else if (ctx.target === "openapi-3.0") {
    json.items = {
      anyOf: prefixItems
    };
    if (rest) {
      json.items.anyOf.push(rest);
    }
    json.minItems = prefixItems.length;
    if (!rest) {
      json.maxItems = prefixItems.length;
    }
  } else {
    json.items = prefixItems;
    if (rest) {
      json.additionalItems = rest;
    }
  }
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
};
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      json.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = process2(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json.additionalProperties = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var promiseProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var lazyProcessor = (schema, ctx, _json, params) => {
  const innerType = schema._zod.innerType;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
// node_modules/zod/v4/classic/schemas.js
var exports_schemas2 = {};
__export(exports_schemas2, {
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodIntersection: () => ZodIntersection,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  codec: () => codec,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  custom: () => custom,
  date: () => date3,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  enum: () => _enum,
  exactOptional: () => exactOptional,
  file: () => file,
  float32: () => float32,
  float64: () => float64,
  function: () => _function,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  literal: () => literal,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  mac: () => mac2,
  map: () => map,
  meta: () => meta2,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  never: () => never,
  nonoptional: () => nonoptional,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  prefault: () => prefault,
  preprocess: () => preprocess,
  promise: () => promise,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  set: () => set,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  transform: () => transform,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  url: () => url,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});

// node_modules/zod/v4/classic/checks.js
var exports_checks2 = {};
__export(exports_checks2, {
  endsWith: () => _endsWith,
  gt: () => _gt,
  gte: () => _gte,
  includes: () => _includes,
  length: () => _length,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  negative: () => _negative,
  nonnegative: () => _nonnegative,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  overwrite: () => _overwrite,
  positive: () => _positive,
  property: () => _property,
  regex: () => _regex,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  trim: () => _trim,
  uppercase: () => _uppercase
});

// node_modules/zod/v4/classic/iso.js
var exports_iso = {};
__export(exports_iso, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date2,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue) => {
        inst.issues.push(issue);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues) => {
        inst.issues.push(...issues);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodError = /* @__PURE__ */ $constructor("ZodError", initializer2);
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap;
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = new Set;
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse3(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def = this.def;
      return this.clone(mergeDefs(def, {
        checks: [
          ...def.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def, params) {
      return clone(this, def, params);
    },
    brand() {
      return this;
    },
    register(reg, meta) {
      reg.add(this, meta);
      return this;
    },
    refine(check2, params) {
      return this.check(refine(check2, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(undefined).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => stringProcessor(inst, ctx, json2, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function email2(params) {
  return _email(ZodEmail, params);
}
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function guid2(params) {
  return _guid(ZodGUID, params);
}
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function uuid2(params) {
  return _uuid(ZodUUID, params);
}
function uuidv4(params) {
  return _uuidv4(ZodUUID, params);
}
function uuidv6(params) {
  return _uuidv6(ZodUUID, params);
}
function uuidv7(params) {
  return _uuidv7(ZodUUID, params);
}
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return _url(ZodURL, params);
}
function httpUrl(params) {
  return _url(ZodURL, {
    protocol: httpProtocol,
    hostname: domain,
    ...normalizeParams(params)
  });
}
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function emoji2(params) {
  return _emoji2(ZodEmoji, params);
}
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function nanoid2(params) {
  return _nanoid(ZodNanoID, params);
}
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid3(params) {
  return _cuid(ZodCUID, params);
}
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid22(params) {
  return _cuid2(ZodCUID2, params);
}
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ulid2(params) {
  return _ulid(ZodULID, params);
}
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function xid2(params) {
  return _xid(ZodXID, params);
}
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ksuid2(params) {
  return _ksuid(ZodKSUID, params);
}
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv42(params) {
  return _ipv4(ZodIPv4, params);
}
var ZodMAC = /* @__PURE__ */ $constructor("ZodMAC", (inst, def) => {
  $ZodMAC.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function mac2(params) {
  return _mac(ZodMAC, params);
}
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv62(params) {
  return _ipv6(ZodIPv6, params);
}
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv42(params) {
  return _cidrv4(ZodCIDRv4, params);
}
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv62(params) {
  return _cidrv6(ZodCIDRv6, params);
}
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base642(params) {
  return _base64(ZodBase64, params);
}
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base64url2(params) {
  return _base64url(ZodBase64URL, params);
}
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function e1642(params) {
  return _e164(ZodE164, params);
}
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function jwt(params) {
  return _jwt(ZodJWT, params);
}
var ZodCustomStringFormat = /* @__PURE__ */ $constructor("ZodCustomStringFormat", (inst, def) => {
  $ZodCustomStringFormat.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function stringFormat(format, fnOrRegex, _params = {}) {
  return _stringFormat(ZodCustomStringFormat, format, fnOrRegex, _params);
}
function hostname2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hostname", hostname, _params);
}
function hex2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hex", hex, _params);
}
function hash(alg, params) {
  const enc = params?.enc ?? "hex";
  const format = `${alg}_${enc}`;
  const regex = exports_regexes[format];
  if (!regex)
    throw new Error(`Unrecognized hash format: ${format}`);
  return _stringFormat(ZodCustomStringFormat, format, regex, params);
}
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => numberProcessor(inst, ctx, json2, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
function float32(params) {
  return _float32(ZodNumberFormat, params);
}
function float64(params) {
  return _float64(ZodNumberFormat, params);
}
function int32(params) {
  return _int32(ZodNumberFormat, params);
}
function uint32(params) {
  return _uint32(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => booleanProcessor(inst, ctx, json2, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodBigInt = /* @__PURE__ */ $constructor("ZodBigInt", (inst, def) => {
  $ZodBigInt.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => bigintProcessor(inst, ctx, json2, params);
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.positive = (params) => inst.check(_gt(BigInt(0), params));
  inst.negative = (params) => inst.check(_lt(BigInt(0), params));
  inst.nonpositive = (params) => inst.check(_lte(BigInt(0), params));
  inst.nonnegative = (params) => inst.check(_gte(BigInt(0), params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  const bag = inst._zod.bag;
  inst.minValue = bag.minimum ?? null;
  inst.maxValue = bag.maximum ?? null;
  inst.format = bag.format ?? null;
});
function bigint2(params) {
  return _bigint(ZodBigInt, params);
}
var ZodBigIntFormat = /* @__PURE__ */ $constructor("ZodBigIntFormat", (inst, def) => {
  $ZodBigIntFormat.init(inst, def);
  ZodBigInt.init(inst, def);
});
function int64(params) {
  return _int64(ZodBigIntFormat, params);
}
function uint64(params) {
  return _uint64(ZodBigIntFormat, params);
}
var ZodSymbol = /* @__PURE__ */ $constructor("ZodSymbol", (inst, def) => {
  $ZodSymbol.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => symbolProcessor(inst, ctx, json2, params);
});
function symbol(params) {
  return _symbol(ZodSymbol, params);
}
var ZodUndefined = /* @__PURE__ */ $constructor("ZodUndefined", (inst, def) => {
  $ZodUndefined.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => undefinedProcessor(inst, ctx, json2, params);
});
function _undefined3(params) {
  return _undefined2(ZodUndefined, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullProcessor(inst, ctx, json2, params);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodAny = /* @__PURE__ */ $constructor("ZodAny", (inst, def) => {
  $ZodAny.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => anyProcessor(inst, ctx, json2, params);
});
function any() {
  return _any(ZodAny);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unknownProcessor(inst, ctx, json2, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => neverProcessor(inst, ctx, json2, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodVoid = /* @__PURE__ */ $constructor("ZodVoid", (inst, def) => {
  $ZodVoid.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => voidProcessor(inst, ctx, json2, params);
});
function _void2(params) {
  return _void(ZodVoid, params);
}
var ZodDate = /* @__PURE__ */ $constructor("ZodDate", (inst, def) => {
  $ZodDate.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => dateProcessor(inst, ctx, json2, params);
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  const c = inst._zod.bag;
  inst.minDate = c.minimum ? new Date(c.minimum) : null;
  inst.maxDate = c.maximum ? new Date(c.maximum) : null;
});
function date3(params) {
  return _date(ZodDate, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => arrayProcessor(inst, ctx, json2, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
function keyof(schema) {
  const shape = schema._zod.def.shape;
  return _enum(Object.keys(shape));
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => objectProcessor(inst, ctx, json2, params);
  defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: undefined });
    },
    extend(incoming) {
      return extend(this, incoming);
    },
    safeExtend(incoming) {
      return safeExtend(this, incoming);
    },
    merge(other) {
      return merge(this, other);
    },
    pick(mask) {
      return pick(this, mask);
    },
    omit(mask) {
      return omit(this, mask);
    },
    partial(...args) {
      return partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...normalizeParams(params)
  });
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodXor = /* @__PURE__ */ $constructor("ZodXor", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodXor.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function xor(options, params) {
  return new ZodXor({
    type: "union",
    options,
    inclusive: false,
    ...normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => intersectionProcessor(inst, ctx, json2, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
  $ZodTuple.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => tupleProcessor(inst, ctx, json2, params);
  inst.rest = (rest) => inst.clone({
    ...inst._zod.def,
    rest
  });
});
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...normalizeParams(params)
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => recordProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
function partialRecord(keyType, valueType, params) {
  const k = clone(keyType);
  k._zod.values = undefined;
  return new ZodRecord({
    type: "record",
    keyType: k,
    valueType,
    ...normalizeParams(params)
  });
}
function looseRecord(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    mode: "loose",
    ...normalizeParams(params)
  });
}
var ZodMap = /* @__PURE__ */ $constructor("ZodMap", (inst, def) => {
  $ZodMap.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => mapProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function map(keyType, valueType, params) {
  return new ZodMap({
    type: "map",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodSet = /* @__PURE__ */ $constructor("ZodSet", (inst, def) => {
  $ZodSet.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => setProcessor(inst, ctx, json2, params);
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function set(valueType, params) {
  return new ZodSet({
    type: "set",
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => enumProcessor(inst, ctx, json2, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
function nativeEnum(entries, params) {
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => literalProcessor(inst, ctx, json2, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodFile = /* @__PURE__ */ $constructor("ZodFile", (inst, def) => {
  $ZodFile.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => fileProcessor(inst, ctx, json2, params);
  inst.min = (size, params) => inst.check(_minSize(size, params));
  inst.max = (size, params) => inst.check(_maxSize(size, params));
  inst.mime = (types, params) => inst.check(_mime(Array.isArray(types) ? types : [types], params));
});
function file(params) {
  return _file(ZodFile, params);
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => transformProcessor(inst, ctx, json2, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullableProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function nullish2(innerType) {
  return optional(nullable(innerType));
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => defaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => prefaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nonoptionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodSuccess = /* @__PURE__ */ $constructor("ZodSuccess", (inst, def) => {
  $ZodSuccess.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => successProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function success(innerType) {
  return new ZodSuccess({
    type: "success",
    innerType
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => catchProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodNaN = /* @__PURE__ */ $constructor("ZodNaN", (inst, def) => {
  $ZodNaN.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nanProcessor(inst, ctx, json2, params);
});
function nan(params) {
  return _nan(ZodNaN, params);
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => pipeProcessor(inst, ctx, json2, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodCodec = /* @__PURE__ */ $constructor("ZodCodec", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodCodec.init(inst, def);
});
function codec(in_, out, params) {
  return new ZodCodec({
    type: "pipe",
    in: in_,
    out,
    transform: params.decode,
    reverseTransform: params.encode
  });
}
function invertCodec(codec2) {
  const def = codec2._zod.def;
  return new ZodCodec({
    type: "pipe",
    in: def.out,
    out: def.in,
    transform: def.reverseTransform,
    reverseTransform: def.transform
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => readonlyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodTemplateLiteral = /* @__PURE__ */ $constructor("ZodTemplateLiteral", (inst, def) => {
  $ZodTemplateLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => templateLiteralProcessor(inst, ctx, json2, params);
});
function templateLiteral(parts, params) {
  return new ZodTemplateLiteral({
    type: "template_literal",
    parts,
    ...normalizeParams(params)
  });
}
var ZodLazy = /* @__PURE__ */ $constructor("ZodLazy", (inst, def) => {
  $ZodLazy.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => lazyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
  return new ZodLazy({
    type: "lazy",
    getter
  });
}
var ZodPromise = /* @__PURE__ */ $constructor("ZodPromise", (inst, def) => {
  $ZodPromise.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => promiseProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function promise(innerType) {
  return new ZodPromise({
    type: "promise",
    innerType
  });
}
var ZodFunction = /* @__PURE__ */ $constructor("ZodFunction", (inst, def) => {
  $ZodFunction.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => functionProcessor(inst, ctx, json2, params);
});
function _function(params) {
  return new ZodFunction({
    type: "function",
    input: Array.isArray(params?.input) ? tuple(params?.input) : params?.input ?? array(unknown()),
    output: params?.output ?? unknown()
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => customProcessor(inst, ctx, json2, params);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
  });
  ch._zod.check = fn;
  return ch;
}
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
var describe2 = describe;
var meta2 = meta;
function _instanceof(cls, params = {}) {
  const inst = new ZodCustom({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...normalizeParams(params)
  });
  inst._zod.bag.Class = cls;
  inst._zod.check = (payload) => {
    if (!(payload.value instanceof cls)) {
      payload.issues.push({
        code: "invalid_type",
        expected: cls.name,
        input: payload.value,
        inst,
        path: [...inst._zod.def.path ?? []]
      });
    }
  };
  return inst;
}
var stringbool = (...args) => _stringbool({
  Codec: ZodCodec,
  Boolean: ZodBoolean,
  String: ZodString
}, ...args);
function json(params) {
  const jsonSchema = lazy(() => {
    return union([string2(params), number2(), boolean2(), _null3(), array(jsonSchema), record(string2(), jsonSchema)]);
  });
  return jsonSchema;
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}
// node_modules/zod/v4/classic/from-json-schema.js
var z = {
  ...exports_schemas2,
  ...exports_checks2,
  iso: exports_iso
};
var RECOGNIZED_KEYS = /* @__PURE__ */ new Set([
  "$schema",
  "$ref",
  "$defs",
  "definitions",
  "$id",
  "id",
  "$comment",
  "$anchor",
  "$vocabulary",
  "$dynamicRef",
  "$dynamicAnchor",
  "type",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "items",
  "prefixItems",
  "additionalItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "description",
  "default",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "unevaluatedItems",
  "unevaluatedProperties",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  "nullable",
  "readOnly"
]);
function detectVersion(schema, defaultTarget) {
  const $schema = schema.$schema;
  if ($schema === "https://json-schema.org/draft/2020-12/schema") {
    return "draft-2020-12";
  }
  if ($schema === "http://json-schema.org/draft-07/schema#") {
    return "draft-7";
  }
  if ($schema === "http://json-schema.org/draft-04/schema#") {
    return "draft-4";
  }
  return defaultTarget ?? "draft-2020-12";
}
function resolveRef(ref, ctx) {
  if (!ref.startsWith("#")) {
    throw new Error("External $ref is not supported, only local refs (#/...) are allowed");
  }
  const path = ref.slice(1).split("/").filter(Boolean);
  if (path.length === 0) {
    return ctx.rootSchema;
  }
  const defsKey = ctx.version === "draft-2020-12" ? "$defs" : "definitions";
  if (path[0] === defsKey) {
    const key = path[1];
    if (!key || !ctx.defs[key]) {
      throw new Error(`Reference not found: ${ref}`);
    }
    return ctx.defs[key];
  }
  throw new Error(`Reference not found: ${ref}`);
}
function convertBaseSchema(schema, ctx) {
  if (schema.not !== undefined) {
    if (typeof schema.not === "object" && Object.keys(schema.not).length === 0) {
      return z.never();
    }
    throw new Error("not is not supported in Zod (except { not: {} } for never)");
  }
  if (schema.unevaluatedItems !== undefined) {
    throw new Error("unevaluatedItems is not supported");
  }
  if (schema.unevaluatedProperties !== undefined) {
    throw new Error("unevaluatedProperties is not supported");
  }
  if (schema.if !== undefined || schema.then !== undefined || schema.else !== undefined) {
    throw new Error("Conditional schemas (if/then/else) are not supported");
  }
  if (schema.dependentSchemas !== undefined || schema.dependentRequired !== undefined) {
    throw new Error("dependentSchemas and dependentRequired are not supported");
  }
  if (schema.$ref) {
    const refPath = schema.$ref;
    if (ctx.refs.has(refPath)) {
      return ctx.refs.get(refPath);
    }
    if (ctx.processing.has(refPath)) {
      return z.lazy(() => {
        if (!ctx.refs.has(refPath)) {
          throw new Error(`Circular reference not resolved: ${refPath}`);
        }
        return ctx.refs.get(refPath);
      });
    }
    ctx.processing.add(refPath);
    const resolved = resolveRef(refPath, ctx);
    const zodSchema = convertSchema(resolved, ctx);
    ctx.refs.set(refPath, zodSchema);
    ctx.processing.delete(refPath);
    return zodSchema;
  }
  if (schema.enum !== undefined) {
    const enumValues = schema.enum;
    if (ctx.version === "openapi-3.0" && schema.nullable === true && enumValues.length === 1 && enumValues[0] === null) {
      return z.null();
    }
    if (enumValues.length === 0) {
      return z.never();
    }
    if (enumValues.length === 1) {
      return z.literal(enumValues[0]);
    }
    if (enumValues.every((v) => typeof v === "string")) {
      return z.enum(enumValues);
    }
    const literalSchemas = enumValues.map((v) => z.literal(v));
    if (literalSchemas.length < 2) {
      return literalSchemas[0];
    }
    return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)]);
  }
  if (schema.const !== undefined) {
    return z.literal(schema.const);
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    const typeSchemas = type.map((t) => {
      const typeSchema = { ...schema, type: t };
      return convertBaseSchema(typeSchema, ctx);
    });
    if (typeSchemas.length === 0) {
      return z.never();
    }
    if (typeSchemas.length === 1) {
      return typeSchemas[0];
    }
    return z.union(typeSchemas);
  }
  if (!type) {
    return z.any();
  }
  let zodSchema;
  switch (type) {
    case "string": {
      let stringSchema = z.string();
      if (schema.format) {
        const format = schema.format;
        if (format === "email") {
          stringSchema = stringSchema.check(z.email());
        } else if (format === "uri" || format === "uri-reference") {
          stringSchema = stringSchema.check(z.url());
        } else if (format === "uuid" || format === "guid") {
          stringSchema = stringSchema.check(z.uuid());
        } else if (format === "date-time") {
          stringSchema = stringSchema.check(z.iso.datetime());
        } else if (format === "date") {
          stringSchema = stringSchema.check(z.iso.date());
        } else if (format === "time") {
          stringSchema = stringSchema.check(z.iso.time());
        } else if (format === "duration") {
          stringSchema = stringSchema.check(z.iso.duration());
        } else if (format === "ipv4") {
          stringSchema = stringSchema.check(z.ipv4());
        } else if (format === "ipv6") {
          stringSchema = stringSchema.check(z.ipv6());
        } else if (format === "mac") {
          stringSchema = stringSchema.check(z.mac());
        } else if (format === "cidr") {
          stringSchema = stringSchema.check(z.cidrv4());
        } else if (format === "cidr-v6") {
          stringSchema = stringSchema.check(z.cidrv6());
        } else if (format === "base64") {
          stringSchema = stringSchema.check(z.base64());
        } else if (format === "base64url") {
          stringSchema = stringSchema.check(z.base64url());
        } else if (format === "e164") {
          stringSchema = stringSchema.check(z.e164());
        } else if (format === "jwt") {
          stringSchema = stringSchema.check(z.jwt());
        } else if (format === "emoji") {
          stringSchema = stringSchema.check(z.emoji());
        } else if (format === "nanoid") {
          stringSchema = stringSchema.check(z.nanoid());
        } else if (format === "cuid") {
          stringSchema = stringSchema.check(z.cuid());
        } else if (format === "cuid2") {
          stringSchema = stringSchema.check(z.cuid2());
        } else if (format === "ulid") {
          stringSchema = stringSchema.check(z.ulid());
        } else if (format === "xid") {
          stringSchema = stringSchema.check(z.xid());
        } else if (format === "ksuid") {
          stringSchema = stringSchema.check(z.ksuid());
        }
      }
      if (typeof schema.minLength === "number") {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (typeof schema.maxLength === "number") {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (schema.pattern) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern));
      }
      zodSchema = stringSchema;
      break;
    }
    case "number":
    case "integer": {
      let numberSchema = type === "integer" ? z.number().int() : z.number();
      if (typeof schema.minimum === "number") {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number") {
        numberSchema = numberSchema.max(schema.maximum);
      }
      if (typeof schema.exclusiveMinimum === "number") {
        numberSchema = numberSchema.gt(schema.exclusiveMinimum);
      } else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
        numberSchema = numberSchema.gt(schema.minimum);
      }
      if (typeof schema.exclusiveMaximum === "number") {
        numberSchema = numberSchema.lt(schema.exclusiveMaximum);
      } else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number") {
        numberSchema = numberSchema.lt(schema.maximum);
      }
      if (typeof schema.multipleOf === "number") {
        numberSchema = numberSchema.multipleOf(schema.multipleOf);
      }
      zodSchema = numberSchema;
      break;
    }
    case "boolean": {
      zodSchema = z.boolean();
      break;
    }
    case "null": {
      zodSchema = z.null();
      break;
    }
    case "object": {
      const shape = {};
      const properties = schema.properties || {};
      const requiredSet = new Set(schema.required || []);
      for (const [key, propSchema] of Object.entries(properties)) {
        const propZodSchema = convertSchema(propSchema, ctx);
        shape[key] = requiredSet.has(key) ? propZodSchema : propZodSchema.optional();
      }
      if (schema.propertyNames) {
        const keySchema = convertSchema(schema.propertyNames, ctx);
        const valueSchema = schema.additionalProperties && typeof schema.additionalProperties === "object" ? convertSchema(schema.additionalProperties, ctx) : z.any();
        if (Object.keys(shape).length === 0) {
          zodSchema = z.record(keySchema, valueSchema);
          break;
        }
        const objectSchema = z.object(shape).passthrough();
        const recordSchema = z.looseRecord(keySchema, valueSchema);
        zodSchema = z.intersection(objectSchema, recordSchema);
        break;
      }
      if (schema.patternProperties) {
        const patternProps = schema.patternProperties;
        const patternKeys = Object.keys(patternProps);
        const looseRecords = [];
        for (const pattern of patternKeys) {
          const patternValue = convertSchema(patternProps[pattern], ctx);
          const keySchema = z.string().regex(new RegExp(pattern));
          looseRecords.push(z.looseRecord(keySchema, patternValue));
        }
        const schemasToIntersect = [];
        if (Object.keys(shape).length > 0) {
          schemasToIntersect.push(z.object(shape).passthrough());
        }
        schemasToIntersect.push(...looseRecords);
        if (schemasToIntersect.length === 0) {
          zodSchema = z.object({}).passthrough();
        } else if (schemasToIntersect.length === 1) {
          zodSchema = schemasToIntersect[0];
        } else {
          let result = z.intersection(schemasToIntersect[0], schemasToIntersect[1]);
          for (let i = 2;i < schemasToIntersect.length; i++) {
            result = z.intersection(result, schemasToIntersect[i]);
          }
          zodSchema = result;
        }
        break;
      }
      const objectSchema = z.object(shape);
      if (schema.additionalProperties === false) {
        zodSchema = objectSchema.strict();
      } else if (typeof schema.additionalProperties === "object") {
        zodSchema = objectSchema.catchall(convertSchema(schema.additionalProperties, ctx));
      } else {
        zodSchema = objectSchema.passthrough();
      }
      break;
    }
    case "array": {
      const prefixItems = schema.prefixItems;
      const items = schema.items;
      if (prefixItems && Array.isArray(prefixItems)) {
        const tupleItems = prefixItems.map((item) => convertSchema(item, ctx));
        const rest = items && typeof items === "object" && !Array.isArray(items) ? convertSchema(items, ctx) : undefined;
        if (rest) {
          zodSchema = z.tuple(tupleItems).rest(rest);
        } else {
          zodSchema = z.tuple(tupleItems);
        }
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (Array.isArray(items)) {
        const tupleItems = items.map((item) => convertSchema(item, ctx));
        const rest = schema.additionalItems && typeof schema.additionalItems === "object" ? convertSchema(schema.additionalItems, ctx) : undefined;
        if (rest) {
          zodSchema = z.tuple(tupleItems).rest(rest);
        } else {
          zodSchema = z.tuple(tupleItems);
        }
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (items !== undefined) {
        const element = convertSchema(items, ctx);
        let arraySchema = z.array(element);
        if (typeof schema.minItems === "number") {
          arraySchema = arraySchema.min(schema.minItems);
        }
        if (typeof schema.maxItems === "number") {
          arraySchema = arraySchema.max(schema.maxItems);
        }
        zodSchema = arraySchema;
      } else {
        zodSchema = z.array(z.any());
      }
      break;
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
  return zodSchema;
}
function convertSchema(schema, ctx) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let baseSchema = convertBaseSchema(schema, ctx);
  const hasExplicitType = schema.type || schema.enum !== undefined || schema.const !== undefined;
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((s) => convertSchema(s, ctx));
    const anyOfUnion = z.union(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, anyOfUnion) : anyOfUnion;
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const options = schema.oneOf.map((s) => convertSchema(s, ctx));
    const oneOfUnion = z.xor(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, oneOfUnion) : oneOfUnion;
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    if (schema.allOf.length === 0) {
      baseSchema = hasExplicitType ? baseSchema : z.any();
    } else {
      let result = hasExplicitType ? baseSchema : convertSchema(schema.allOf[0], ctx);
      const startIdx = hasExplicitType ? 0 : 1;
      for (let i = startIdx;i < schema.allOf.length; i++) {
        result = z.intersection(result, convertSchema(schema.allOf[i], ctx));
      }
      baseSchema = result;
    }
  }
  if (schema.nullable === true && ctx.version === "openapi-3.0") {
    baseSchema = z.nullable(baseSchema);
  }
  if (schema.readOnly === true) {
    baseSchema = z.readonly(baseSchema);
  }
  if (schema.default !== undefined) {
    baseSchema = baseSchema.default(schema.default);
  }
  const extraMeta = {};
  const coreMetadataKeys = ["$id", "id", "$comment", "$anchor", "$vocabulary", "$dynamicRef", "$dynamicAnchor"];
  for (const key of coreMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  const contentMetadataKeys = ["contentEncoding", "contentMediaType", "contentSchema"];
  for (const key of contentMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  for (const key of Object.keys(schema)) {
    if (!RECOGNIZED_KEYS.has(key)) {
      extraMeta[key] = schema[key];
    }
  }
  if (Object.keys(extraMeta).length > 0) {
    ctx.registry.add(baseSchema, extraMeta);
  }
  if (schema.description) {
    baseSchema = baseSchema.describe(schema.description);
  }
  return baseSchema;
}
function fromJSONSchema(schema, params) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(schema));
  } catch {
    throw new Error("fromJSONSchema input is not valid JSON (possibly cyclic); use $defs/$ref for recursive schemas");
  }
  const version = detectVersion(normalized, params?.defaultTarget);
  const defs = normalized.$defs || normalized.definitions || {};
  const ctx = {
    version,
    defs,
    refs: new Map,
    processing: new Set,
    rootSchema: normalized,
    registry: params?.registry ?? globalRegistry
  };
  return convertSchema(normalized, ctx);
}
// node_modules/zod/v4/classic/external.js
config(en_default());
// packages/engine/src/modules/steward/builtin/agent/runtime.ts
import { chrona, on, onDisconnect, ModelError } from "chrona";

// packages/contracts/src/steward/module-output.ts
var jsonType = _enum(["object", "array", "string", "number", "integer", "boolean", "null"]);
var shape = lazy(() => object({
  type: union([jsonType, array(jsonType).min(1)]).optional(),
  title: string2().optional(),
  description: string2().optional(),
  properties: record(string2(), shape).optional(),
  required: array(string2()).optional(),
  additionalProperties: union([boolean2(), shape]).optional(),
  items: shape.optional(),
  enum: array(json()).min(1).optional(),
  const: json().optional(),
  anyOf: array(shape).min(1).optional(),
  allOf: array(shape).min(1).optional()
}).strict().refine((schema) => !schema.required || schema.required.every((key) => Object.hasOwn(schema.properties ?? {}, key)), "Required fields must be declared in properties in the same schema"));
var compiled = new WeakMap;
function compileModuleOutput(schema) {
  const known = compiled.get(schema);
  if (known)
    return known;
  const result = fromJSONSchema(schema);
  compiled.set(schema, result);
  return result;
}
var moduleOutputSchema = record(string2(), json()).superRefine((schema, ctx) => {
  if (JSON.stringify(schema).length > 8000) {
    ctx.addIssue({ code: "custom", message: "Tool output schema exceeds 8000 characters" });
    return;
  }
  if (!shape.safeParse(schema).success) {
    ctx.addIssue({ code: "custom", message: "Tool output schema uses unsupported structure or keywords" });
    return;
  }
  try {
    compileModuleOutput(schema);
  } catch {
    ctx.addIssue({ code: "custom", message: "Tool output schema cannot be compiled" });
  }
});

// packages/contracts/src/steward/module-input.ts
var description = string2().max(300).optional();
var parameter = lazy(() => union([
  object({ type: literal("string"), description, enum: array(string2().max(100)).min(1).max(20).optional() }).strict(),
  object({ type: _enum(["number", "boolean"]), description }).strict(),
  object({ type: literal("array"), description, items: parameter }).strict(),
  object({ type: literal("object"), description, properties: record(string2().min(1).max(100), parameter), required: array(string2().min(1).max(100)).default([]), additionalProperties: boolean2().default(false) }).strict().refine((value) => value.required.every((key) => Object.hasOwn(value.properties, key)), "Required fields must be declared in properties")
]));
var moduleToolParameterSchema = unknown().superRefine((value, ctx) => {
  let nodes = 0;
  const visit = (item, depth) => {
    if (++nodes > 1000 || depth > 24)
      return false;
    if (item && typeof item === "object")
      return Object.values(item).every((child) => visit(child, depth + 1));
    return true;
  };
  if (!visit(value, 0))
    ctx.addIssue({ code: "custom", message: "Tool parameter schema is too deeply nested or too large", fatal: true });
}).pipe(parameter);

// packages/contracts/src/steward/module-tool.ts
var slug = string2().regex(/^[a-z][a-z0-9-]{1,40}$/);
var TOOL_VISIBILITY = ["provider", "owner", "modules", "kernel"];
var withoutCallers = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("callers" in value))
    return value;
  const { callers: _callers, ...rest } = value;
  return rest;
};
var moduleToolSchema = preprocess(withoutCallers, object({
  name: slug,
  description: string2().min(1).max(500),
  output: moduleOutputSchema.optional(),
  examples: array(object({ description: string2().max(300).optional(), args: record(string2(), json()), result: json().optional() }).strict()).max(3).optional(),
  sideEffects: array(string2().min(1).max(300)).max(8).optional(),
  errors: array(object({ code: string2().min(1).max(80), description: string2().min(1).max(300), recovery: string2().min(1).max(300) }).strict()).max(8).optional(),
  parameters: object({ type: literal("object"), properties: record(slug, moduleToolParameterSchema).default({}), required: array(slug).default([]) }).strict(),
  visibility: array(_enum(TOOL_VISIBILITY)).min(1).max(TOOL_VISIBILITY.length).default(["provider", "owner"]),
  idempotent: boolean2().default(false)
}).strict());
// packages/contracts/src/steward/module-lifecycle.ts
var PREINSTALLED_MODULE_NAMES = ["web", "notify", "qq", "author"];
var OPTIONAL_EXTERNAL_MODULE_NAMES = ["memory-local", "coding", "coding-web", "mcp", "files", "events", "remind", "mind"];
var INITIALIZATION_MODULE_NAMES = ["web", "notify", "qq", "author", "remind", "mind"];
var OFFICIAL_EXTERNAL_MODULE_NAMES = [...PREINSTALLED_MODULE_NAMES, ...OPTIONAL_EXTERNAL_MODULE_NAMES];
var moduleVersionHashSchema = string2().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
var moduleOriginSchema = _enum(["kernel", "builtin", "external"]);
var moduleCapabilitiesSchema = object({
  build: boolean2(),
  propose: boolean2(),
  group: boolean2(),
  activate: boolean2(),
  update: boolean2(),
  rollback: boolean2(),
  remove: boolean2(),
  install: boolean2(),
  enable: boolean2(),
  disable: boolean2(),
  configure: boolean2(),
  diagnose: boolean2()
}).strict();
var moduleInstallRequestSchema = object({
  package: _enum(OFFICIAL_EXTERNAL_MODULE_NAMES),
  mode: _enum(["install", "update"]),
  requestKey: string2().trim().min(1).max(120)
}).strict();
var moduleInstallResultSchema = object({
  package: _enum(OFFICIAL_EXTERNAL_MODULE_NAMES),
  requestKey: string2(),
  status: _enum(["pending", "building", "pending_approval", "installed", "failed", "unavailable"]),
  moduleId: string2().nullable(),
  hash: moduleVersionHashSchema.nullable(),
  approvalId: string2().nullable(),
  error: object({ code: _enum(["invalid", "forbidden", "conflict", "not_found", "failed", "unavailable"]), reason: string2(), message: string2() }).strict().nullable()
}).strict();
var moduleInitializationStateSchema = object({
  version: literal(1),
  status: _enum(["pending", "complete"]),
  packages: record(_enum(INITIALIZATION_MODULE_NAMES), object({
    requestKey: string2(),
    attempts: number2().int().min(1),
    status: _enum(["pending", "building", "pending_approval", "installed", "failed", "unavailable", "skipped"]),
    moduleId: string2().nullable(),
    hash: string2().nullable(),
    approvalId: string2().nullable(),
    error: moduleInstallResultSchema.shape.error
  }).strict())
}).strict();
var moduleUpstreamRequestSchema = discriminatedUnion("action", [
  object({ action: literal("status"), moduleId: string2().min(1) }).strict(),
  object({ action: literal("fetch"), moduleId: string2().min(1) }).strict(),
  object({ action: literal("merge"), moduleId: string2().min(1), commit: string2().regex(/^[a-f0-9]{40}$/), baseHash: moduleVersionHashSchema, requestKey: string2().trim().min(1).max(200) }).strict()
]);
// packages/contracts/src/steward/provider.ts
var id = string2().min(1).max(128);
var iso = string2().datetime({ offset: true });
var count = number2().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
var providerPhaseSchema = _enum(["thinking", "reading", "writing", "searching", "executing", "recovering", "waiting"]);
var providerProgressSchema = object({ phase: providerPhaseSchema, tool: string2().regex(/^[\w:.-]{1,100}$/).nullable() }).strict();
var providerUsageSchema = object({
  scope: _enum(["run", "session"]),
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
  total: count,
  cost: number2().finite().nonnegative(),
  contextTokens: count.nullable(),
  contextWindow: count.nullable()
}).strict();
var providerResourcesSchema = object({ version: string2().max(40), skills: array(string2().max(100)).max(50), extensions: count }).strict();
var providerQuestionSchema = object({
  method: _enum(["select", "confirm", "input", "editor"]),
  title: string2().min(1).max(200),
  message: string2().max(2000),
  options: array(string2().max(300)).max(30),
  prefill: string2().max(8000).optional(),
  timeoutMs: number2().int().positive().max(300000)
}).strict().refine((question) => question.method !== "select" || question.options.length > 0, "Select requires options").refine((question) => question.prefill === undefined || question.method === "editor", "Only editors can have prefilled text");
var providerAnswerSchema = discriminatedUnion("decision", [
  object({ decision: literal("cancel") }).strict(),
  object({ decision: literal("submit"), value: union([boolean2(), number2().int().nonnegative(), string2().max(8000)]) }).strict()
]);
var providerInteractionSchema = object({
  id,
  runId: id,
  sessionId: id.nullable(),
  question: providerQuestionSchema,
  createdAt: iso,
  expiresAt: iso,
  status: _enum(["pending", "answered", "cancelled", "expired", "interrupted"])
}).strict();
var providerRunViewSchema = object({
  id,
  sessionId: id.nullable(),
  sessionTitle: string2().max(200).nullable(),
  active: boolean2(),
  status: string2().max(40),
  progress: providerProgressSchema.nullable(),
  usage: providerUsageSchema.nullable(),
  resources: providerResourcesSchema.nullable(),
  interactions: array(providerInteractionSchema).max(12),
  updatedAt: iso
}).strict();
// packages/contracts/src/steward/execution.ts
var executionIdSchema = string2().min(1).max(128).regex(/^[\w:.-]+$/);
var id2 = executionIdSchema;
var executionRefSchema = object({ workId: id2, sessionId: id2, runId: id2, attemptId: id2 }).strict();
var executionStartSchema = object({
  workId: id2,
  projectRef: id2,
  commandKey: id2,
  goal: string2().trim().min(1).max(20000),
  resumeFrom: object({ workId: id2, runId: id2, attemptId: id2 }).strict().optional(),
  budget: object({ timeoutMs: number2().int().min(1000).max(1200000), maxToolCalls: number2().int().min(1).max(60) }).strict()
}).strict();
var executionStatusSchema = _enum(["queued", "running", "completed", "failed", "cancelled", "unknown"]);
var executionViewSchema = executionRefSchema.extend({
  projectRef: id2,
  status: executionStatusSchema,
  cancelRequested: boolean2(),
  stopConfirmed: boolean2()
}).strict().refine((value) => value.status !== "cancelled" || value.stopConfirmed, "Cancellation needs stop evidence");
var executionErrorSchema = object({
  code: _enum(["invalid", "unauthorized", "forbidden", "not_found", "conflict", "cursor_expired", "too_large", "capacity", "unavailable", "unsupported_version", "unsupported"]),
  message: string2().min(1).max(500),
  retryable: boolean2(),
  retryAfterMs: number2().int().min(0).max(60000).optional()
}).strict();
var executionCapabilitiesSchema = object({
  history: literal(true),
  messages: literal(true),
  tools: literal(true),
  answer: literal(true),
  cancel: literal(true),
  results: literal(true),
  raw_rpc: literal(false),
  thinking: literal(false),
  direct_bash: literal(false),
  tree: literal(false),
  compaction: literal(false),
  commands: literal(false),
  models: literal(false),
  attachments: literal(false),
  changed_files: literal(false),
  follow_up: literal(false)
}).strict();
var EXECUTION_CAPABILITIES = executionCapabilitiesSchema.parse({ history: true, messages: true, tools: true, answer: true, cancel: true, results: true, raw_rpc: false, thinking: false, direct_bash: false, tree: false, compaction: false, commands: false, models: false, attachments: false, changed_files: false, follow_up: false });
var target = { workId: id2, runId: id2, attemptId: id2 };
var command = { ...target, commandKey: id2 };
var executionCommandSchema = discriminatedUnion("op", [
  object({ op: literal("start"), ...executionStartSchema.shape }).strict(),
  object({ op: literal("get"), workId: id2 }).strict(),
  object({ op: literal("lookup_start"), commandKey: id2 }).strict(),
  object({ op: literal("list"), after: id2.optional(), limit: number2().int().min(1).max(100) }).strict(),
  object({ op: literal("send"), ...command, text: string2().trim().min(1).max(20000) }).strict(),
  object({ op: literal("answer"), ...command, requestId: id2, answer: providerAnswerSchema }).strict(),
  object({ op: literal("cancel"), ...command }).strict(),
  object({ op: literal("attach"), workId: id2, cursor: string2().max(1024).optional() }).strict(),
  object({ op: literal("detach"), workId: id2 }).strict(),
  object({ op: literal("events"), ...target, cursor: string2().max(1024).optional(), limit: number2().int().min(1).max(100), waitMs: number2().int().min(0).max(15000) }).strict(),
  object({ op: literal("snapshot"), ...target }).strict(),
  object({ op: literal("results"), workId: id2 }).strict(),
  object({ op: literal("accept"), workId: id2, resultId: id2, commandKey: id2 }).strict()
]);
var [start, get, lookupStart, list, send, answer, cancel, attach, detach, events, snapshot, results, accept] = executionCommandSchema.options;
var executionInputSchemas = {
  start: start.omit({ op: true }),
  get: get.omit({ op: true }),
  lookup_start: lookupStart.omit({ op: true }),
  list: list.omit({ op: true }),
  send: send.omit({ op: true }),
  answer: answer.omit({ op: true }),
  cancel: cancel.omit({ op: true }),
  attach: attach.omit({ op: true }),
  detach: detach.omit({ op: true }),
  events: events.omit({ op: true }),
  snapshot: snapshot.omit({ op: true }),
  results: results.omit({ op: true }),
  accept: accept.omit({ op: true })
};
var executionBaselineSchema = object({ kind: _enum(["commit", "snapshot"]), digest: string2().min(1).max(128) }).strict();
var executionResultSourceInputSchema = object(target).strict();
var EXECUTION_CHANGES_LIMITS = { bytes: 131072, files: 100, fileBytes: 65536, timeoutMs: 5000 };
var executionChangesSchema = object({
  scope: literal("baseline_to_worktree"),
  status: _enum(["complete", "partial", "unavailable"]),
  reason: _enum(["snapshot_unresolvable", "baseline_unverified", "not_git", "capture_failed", "limit"]).optional(),
  patch: string2().max(EXECUTION_CHANGES_LIMITS.bytes),
  files: array(object({ path: string2().min(1).max(4096), kind: _enum(["tracked", "untracked"]), text: string2().max(EXECUTION_CHANGES_LIMITS.fileBytes).optional(), omitted: _enum(["binary", "symlink", "size", "encoding", "unsupported"]).optional() }).strict()).max(EXECUTION_CHANGES_LIMITS.files)
}).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= EXECUTION_CHANGES_LIMITS.bytes, "Changes exceed byte budget");
var executionResultSourceSchema = executionRefSchema.extend({ baseline: executionBaselineSchema, changes: executionChangesSchema.optional() }).strict();
var executionHostBaselineSchema = string2().regex(/^(commit|snapshot):[^\r\n]+$/).refine((value) => value.slice(value.indexOf(":") + 1).length <= 128, "Baseline digest exceeds limit");
var executionResultSchema = executionRefSchema.extend({
  resultId: id2,
  baseline: executionBaselineSchema,
  artifactRef: id2,
  accepted: boolean2(),
  checks: array(object({ command: string2().min(1).max(1000), outcome: _enum(["passed", "failed", "not_run"]), exitCode: number2().int().nullable() }).strict()).max(50)
}).strict();
// packages/contracts/src/steward/execution-events.ts
var EXECUTION_EVENT_LIMITS = {
  eventBytes: 32 * 1024,
  pageEvents: 100,
  pageBytes: 256 * 1024,
  bufferEvents: 128,
  bufferBytes: 256 * 1024,
  flushMs: 250,
  attemptBytes: 10 * 1024 * 1024,
  detailRetentionMs: 7 * 86400000,
  snapshotRetentionMs: 30 * 86400000,
  detailGlobalBytes: 256 * 1024 * 1024,
  snapshotBytes: 256 * 1024,
  snapshotGlobalBytes: 16 * 1024 * 1024,
  controlBytes: 1024,
  controlGlobalBytes: 4 * 1024 * 1024,
  controlSlotsPerAttempt: 4,
  pollMs: 15000,
  clientTimeoutMs: 20000,
  ownerPolls: 4
};
var seq = number2().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
var at = string2().datetime({ offset: true });
var executionQuestionSchema = object({
  requestId: executionIdSchema,
  title: string2().min(1).max(200),
  method: _enum(["select", "confirm", "input", "editor"]),
  options: array(string2().max(300)).max(30),
  expiresAt: at,
  status: _enum(["pending", "answered", "cancelled", "expired", "interrupted"])
}).strict();
var boundedText = string2().max(24000);
var executionControlSchema = object({
  slot: _enum(["admission", "cancel", "revoke", "terminal"]),
  at,
  status: _enum(["requested", "confirmed", "unknown"]),
  requestId: executionIdSchema.optional()
}).strict().refine((value) => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.controlBytes, "Control slot byte limit exceeded");
var executionEventPayloadSchema = discriminatedUnion("type", [
  object({ type: literal("message"), messageId: executionIdSchema, role: _enum(["user", "assistant"]), text: boundedText, complete: boolean2() }).strict(),
  object({ type: literal("text_delta"), messageId: executionIdSchema, delta: boundedText }).strict(),
  object({ type: literal("tool_started"), toolCallId: executionIdSchema, tool: string2().min(1).max(100), display: object({ path: string2().max(1000).optional(), command: string2().max(1000).optional() }).strict() }).strict(),
  object({ type: literal("tool_finished"), toolCallId: executionIdSchema, tool: string2().min(1).max(100), isError: boolean2(), summary: boundedText, truncated: boolean2(), originalBytes: seq, artifactRef: executionIdSchema.optional() }).strict(),
  object({ type: literal("question"), question: executionQuestionSchema }).strict(),
  object({ type: literal("state"), status: executionStatusSchema, cancelRequested: boolean2(), stopConfirmed: boolean2() }).strict(),
  object({ type: literal("gap"), from: seq, through: seq, reason: _enum(["expired", "truncated", "backpressure", "out_of_order"]) }).strict(),
  object({ type: literal("usage"), input: seq, output: seq }).strict()
]);
function executionJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
var executionEventSchema = executionRefSchema.extend({ seq, at, payload: executionEventPayloadSchema }).strict().refine((value) => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.eventBytes, "Event byte limit exceeded");
var executionEventBatchSchema = array(executionEventSchema).max(EXECUTION_EVENT_LIMITS.pageEvents).refine((value) => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.pageBytes, "Batch byte limit exceeded");
var executionSnapshotSchema = executionRefSchema.extend({
  highWatermark: seq,
  status: executionStatusSchema,
  cancelRequested: boolean2(),
  stopConfirmed: boolean2(),
  finalMessage: object({ messageId: executionIdSchema, text: boundedText, artifactRef: executionIdSchema.optional(), truncated: boolean2() }).strict().nullable(),
  questions: array(executionQuestionSchema).max(12),
  missing: boolean2(),
  expiresAt: at
}).strict().refine((value) => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.snapshotBytes, "Snapshot byte limit exceeded");
var executionEventPageSchema = object({
  events: executionEventBatchSchema,
  cursor: string2().max(1024),
  highWatermark: seq,
  gap: boolean2(),
  snapshotRequired: boolean2()
}).strict().refine((value) => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.pageBytes, "Page byte limit exceeded");
var executionClientMessageSchema = object({
  type: _enum(["message_started", "message_finished"]),
  message: object({ id: executionIdSchema, role: _enum(["user", "assistant"]), content: array(object({ type: literal("text"), text: boundedText }).strict()).max(1) }).strict()
}).strict();
var executionAcceptedSchema = object({ accepted: literal(true) }).strict();
var executionListSchema = object({ works: array(executionViewSchema).max(100), after: executionIdSchema.nullable() }).strict();
var executionResultsSchema = object({ results: array(executionResultSchema).max(100) }).strict();
var executionResponseDataSchemas = {
  start: executionViewSchema,
  get: executionViewSchema,
  lookup_start: executionViewSchema,
  cancel: executionViewSchema,
  attach: executionViewSchema,
  list: executionListSchema,
  send: executionAcceptedSchema,
  answer: executionAcceptedSchema,
  detach: executionAcceptedSchema,
  accept: executionAcceptedSchema,
  events: executionEventPageSchema,
  snapshot: executionSnapshotSchema,
  results: executionResultsSchema
};
// packages/contracts/src/steward/execution-v2.ts
var WORK_PROTOCOL = "chrona.execution.v2";
var WORK_LIMITS = { children: 20, sourceFiles: 100, sourceBytes: 32768, requestBytes: 262144, responseBytes: 262144, queueMs: 86400000 };
var id3 = executionIdSchema;
var relativePath = string2().min(1).max(4096).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.includes("\x00") && !value.split("/").some((part) => part === ".." || part === "." || part === ".git" || !part) && !/^[A-Za-z]:/.test(value), "Expected project relative path");
var executionSourceSchema = object({ files: array(object({ path: relativePath, sha256: string2().regex(/^[a-f0-9]{64}$/) }).strict()).max(WORK_LIMITS.sourceFiles) }).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.sourceBytes && new Set(value.files.map((file) => file.path)).size === value.files.length, "Source manifest exceeds bounds or repeats a path");
var workPlacementSchema = object({ executorId: id3, projectRef: id3, mappingRevision: number2().int().positive() }).strict();
var workBaselineSchema = executionBaselineSchema.refine((value) => value.kind !== "commit" || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.digest), "Commit baseline requires the exact object hash");
var workWorkspaceRequestSchema = object({ mode: _enum(["existing", "independent_worktree"]), baseline: workBaselineSchema, source: executionSourceSchema.optional() }).strict().refine((value) => value.mode !== "independent_worktree" || value.baseline.kind === "commit", "Independent worktree requires an explicit commit");
var workLeafStartSchema = executionStartSchema.omit({ projectRef: true }).extend({ kind: literal("execution"), placement: workPlacementSchema, workspace: workWorkspaceRequestSchema, queueExpiresAt: string2().datetime({ offset: true }), parentWorkId: id3.optional(), dependsOnWorkIds: array(id3).max(WORK_LIMITS.children).default([]) }).strict();
var workGroupStartSchema = object({ kind: literal("group"), workId: id3, commandKey: id3, goal: string2().trim().min(1).max(20000), children: array(workLeafStartSchema.omit({ parentWorkId: true })).min(1).max(WORK_LIMITS.children) }).strict().refine(validWorkGraph, "Children require unique identities/keys and an acyclic graph within this parent");
function validWorkGraph(group) {
  const nodes = new Map(group.children.map((child) => [child.workId, child]));
  if (nodes.size !== group.children.length || nodes.has(group.workId) || new Set([group.commandKey, ...group.children.map((child) => child.commandKey)]).size !== group.children.length + 1)
    return false;
  const visiting = new Set, done = new Set;
  const visit = (workId) => {
    if (visiting.has(workId))
      return false;
    if (done.has(workId))
      return true;
    const child = nodes.get(workId);
    if (!child || new Set(child.dependsOnWorkIds).size !== child.dependsOnWorkIds.length)
      return false;
    visiting.add(workId);
    if (!child.dependsOnWorkIds.every(visit))
      return false;
    visiting.delete(workId);
    done.add(workId);
    return true;
  };
  return group.children.every((child) => visit(child.workId));
}
var workStartSchema = discriminatedUnion("kind", [workLeafStartSchema, workGroupStartSchema]).refine((value) => value.kind === "group" || value.parentWorkId === undefined && value.dependsOnWorkIds.length === 0, "Independent leaves cannot attach to an existing parent");
var workLocationSchema = workPlacementSchema.extend({ label: string2().min(1).max(200), kind: _enum(["server", "device"]), online: boolean2(), baseline: workBaselineSchema, workspaceModes: array(_enum(["existing", "independent_worktree"])).min(1).max(2) }).strict();
var executionSourceReceiptSchema = object({ placement: workPlacementSchema, baseline: workBaselineSchema, manifestDigest: string2().regex(/^[a-f0-9]{64}$/), fileCount: number2().int().min(1).max(WORK_LIMITS.sourceFiles), verifiedAt: string2().datetime({ offset: true }), stage: literal("claim") }).strict();
var workWorkspaceSchema = object({ workspaceRef: id3, mode: _enum(["existing", "independent_worktree"]), baseline: workBaselineSchema, state: _enum(["requested", "ready", "failed", "retained", "removed", "unknown"]), sourceReceipt: executionSourceReceiptSchema.nullable(), retained: boolean2() }).strict().refine((value) => value.sourceReceipt === null || value.sourceReceipt.baseline.kind === value.baseline.kind && value.sourceReceipt.baseline.digest === value.baseline.digest, "Workspace source receipt baseline mismatch");
var workViewSchema = object({ workId: id3, kind: _enum(["execution", "group"]), goal: string2().max(20000), parentWorkId: id3.nullable(), children: array(id3).max(WORK_LIMITS.children), dependsOnWorkIds: array(id3).max(WORK_LIMITS.children), blockedBy: array(id3).max(WORK_LIMITS.children), dependencyResults: array(executionRefSchema.extend({ resultId: id3, artifactRef: id3, baseline: executionBaselineSchema }).strict()).max(WORK_LIMITS.children), queueExpiresAt: string2().datetime({ offset: true }).nullable(), phase: _enum(["waiting_dependency", "waiting_device", "queued", "running", "stopping", "unknown", "completed", "failed", "cancelled"]), cancelRequested: boolean2(), placement: workPlacementSchema.nullable(), workspace: workWorkspaceSchema.nullable(), execution: executionViewSchema.nullable() }).strict().refine((value) => value.kind === "group" ? value.execution === null && value.placement === null && value.workspace === null && value.queueExpiresAt === null && value.parentWorkId === null : value.placement !== null && value.queueExpiresAt !== null && value.children.length === 0 && (value.execution === null || value.execution.workId === value.workId), "Work projection identities disagree").refine((value) => !value.workspace?.sourceReceipt || JSON.stringify(value.workspace.sourceReceipt.placement) === JSON.stringify(value.placement), "Work source receipt placement mismatch");
var [, get2, lookupStart2, , send2, answer2, , attach2, detach2, events2, snapshot2, results2, accept2] = executionCommandSchema.options;
var workCommandSchema = discriminatedUnion("op", [
  object({ op: literal("start"), input: workStartSchema }).strict(),
  get2,
  lookupStart2,
  object({ op: literal("list"), resource: _enum(["works", "locations"]).default("works"), parentWorkId: id3.optional(), after: id3.optional(), limit: number2().int().min(1).max(100) }).strict(),
  send2,
  answer2,
  object({ op: literal("cancel"), workId: id3, commandKey: id3, runId: id3.optional(), attemptId: id3.optional() }).strict().refine((value) => value.runId === undefined === (value.attemptId === undefined), "Both execution identifiers are required together"),
  attach2,
  detach2,
  events2,
  snapshot2,
  results2,
  accept2
]);
var workRequestSchema = object({ v: literal(WORK_PROTOCOL), requestId: id3, command: workCommandSchema }).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.requestBytes, "Work request exceeds byte budget");
var workResultsSchema = object({ results: array(executionResultSchema).max(100), missing: array(id3).max(WORK_LIMITS.children) }).strict();
var workCleanupInputSchema = discriminatedUnion("action", [
  object({ workId: id3, commandKey: id3, action: literal("preview") }).strict(),
  object({ workId: id3, commandKey: id3, action: literal("confirm"), previewDigest: string2().regex(/^[a-f0-9]{64}$/) }).strict()
]);
var workCleanupReceiptSchema = object({ workId: id3, workspaceRef: id3, state: _enum(["retained", "blocked", "removed", "unknown"]), reason: string2().max(500), previewDigest: string2().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
var workResponseDataSchemas = {
  start: workViewSchema,
  get: workViewSchema,
  lookup_start: workViewSchema,
  list: union([object({ resource: literal("works"), works: array(workViewSchema).max(100), after: id3.nullable() }).strict(), object({ resource: literal("locations"), locations: array(workLocationSchema).max(100), after: id3.nullable() }).strict()]),
  send: executionResponseDataSchemas.send,
  answer: executionResponseDataSchemas.answer,
  cancel: workViewSchema,
  attach: workViewSchema,
  detach: executionResponseDataSchemas.detach,
  events: executionResponseDataSchemas.events,
  snapshot: executionResponseDataSchemas.snapshot,
  results: workResultsSchema,
  accept: executionResponseDataSchemas.accept
};
var workResponseEnvelopeSchema = discriminatedUnion("ok", [
  object({ v: literal(WORK_PROTOCOL), requestId: id3, ok: literal(true), data: union([workResponseDataSchemas.start, workResponseDataSchemas.list, workResponseDataSchemas.send, workResponseDataSchemas.events, workResponseDataSchemas.snapshot, workResponseDataSchemas.results, workResponseDataSchemas.accept]) }).strict(),
  object({ v: literal(WORK_PROTOCOL), requestId: id3, ok: literal(false), error: executionErrorSchema }).strict()
]).refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.responseBytes, "Work response exceeds byte budget");
var executionStartV2Schema = workLeafStartSchema.omit({ parentWorkId: true, dependsOnWorkIds: true });
var executionPlacementViewSchema = executionRefSchema.extend({ placement: workPlacementSchema, workspace: workWorkspaceSchema, queueExpiresAt: string2().datetime({ offset: true }), online: boolean2() }).strict();
// packages/contracts/src/steward/execution-tools.ts
var EXECUTION_TOOL_OPERATIONS = { start: "start", get: "get", "lookup-start": "lookup_start", list: "list", send: "send", answer: "answer", cancel: "cancel", events: "events", snapshot: "snapshot" };
var executionToolContracts = [...Object.entries(EXECUTION_TOOL_OPERATIONS).map(([name, op]) => ({
  name,
  description: `Execution ${name}`,
  parameters: { type: "object", properties: {}, required: [] },
  input: executionInputSchemas[op],
  output: executionResponseDataSchemas[op],
  visibility: ["owner", "modules"],
  idempotent: true
})), {
  name: "result-source",
  description: "Read admitted result provenance",
  parameters: { type: "object", properties: {}, required: [] },
  input: executionResultSourceInputSchema,
  output: executionResultSourceSchema,
  visibility: ["owner", "modules"],
  idempotent: true
}, ...[
  { name: "start-v2", input: executionStartV2Schema, output: object({ execution: executionViewSchema, placement: executionPlacementViewSchema }).strict() },
  { name: "placement", input: object({ workId: executionIdSchema }).strict(), output: executionPlacementViewSchema },
  { name: "locations", input: object({ after: executionIdSchema.optional(), limit: number2().int().min(1).max(100) }).strict(), output: object({ locations: array(workLocationSchema).max(100), after: executionIdSchema.nullable() }).strict() },
  { name: "workspace-cleanup", input: workCleanupInputSchema, output: workCleanupReceiptSchema }
].map((tool) => ({ ...tool, description: `Execution ${tool.name}`, parameters: { type: "object", properties: {}, required: [] }, visibility: ["owner", "modules"], idempotent: true }))];
// packages/contracts/src/steward/executor.ts
var EXECUTOR_PROTOCOL = "chrona.executor.v1";
var EXECUTOR_LIMITS = {
  heartbeatMs: 1e4,
  graceMs: 60000,
  pollMs: 1e4,
  requestTimeoutMs: 15000,
  pairMs: 600000,
  pairReceiptMs: 86400000,
  records: 100,
  recordBytes: 32768,
  eventBytes: 262144,
  bodyBytes: 524288,
  finalBytes: 196608,
  launchBytes: 65536,
  proofBytes: 4096,
  bufferRecords: 128,
  bufferBytes: 524288,
  spoolBytes: 10485760,
  sourceReceipts: 8192,
  receiptBytes: 1048576,
  terminalBytes: 262144,
  deviceSpoolBytes: 23592960,
  deviceReceiptBytes: 2097152,
  globalReceiptBytes: 16777216,
  assignmentRecords: 1024,
  deviceRecords: 32,
  pairingRecords: 128,
  reconcileEntries: 100,
  controls: 100,
  controlReceipts: 128,
  codingGlobal: 4,
  codingEnvironment: 2,
  codingApplication: 2
};
var id4 = executionIdSchema;
var iso2 = string2().datetime({ offset: true }).max(40);
var digest = string2().regex(/^[a-f0-9]{64}$/);
var count2 = number2().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
var positive = count2.positive();
var bounded = (limit) => (value) => executionJsonBytes(value) <= limit;
var executorIdentitySchema = object({ executorId: id4, generation: positive }).strict();
var executorFenceSchema = executorIdentitySchema.extend({ incarnation: id4 }).strict();
var executorTargetSchema = executionRefSchema.extend({ assignmentId: id4, generation: positive }).strict();
var envelope = { v: literal(EXECUTOR_PROTOCOL), requestId: id4 };
var request = { ...envelope, ...executorFenceSchema.shape };
var executorPairSchema = object({ ...envelope, code: string2().regex(/^[a-f0-9]{64}$/), label: string2().trim().min(1).max(200) }).strict();
var executorPairReceiptSchema = executorIdentitySchema.extend({ heartbeatMs: literal(EXECUTOR_LIMITS.heartbeatMs), graceMs: literal(EXECUTOR_LIMITS.graceMs) }).strict();
var executorMappingSchema = workPlacementSchema.extend({ directoryIdentity: digest, baseline: workBaselineSchema, label: string2().min(1).max(200) }).strict();
var executionProjectGrantP2Schema = discriminatedUnion("executor", [
  executorMappingSchema.extend({ executor: literal("server"), executorId: literal("server"), executorGeneration: positive, canonicalPath: string2().min(1).max(4096) }).strict(),
  executorMappingSchema.extend({ executor: literal("device"), executorGeneration: positive }).strict()
]);
var executorAssignmentSchema = executorTargetSchema.extend({
  executorId: id4,
  incarnation: id4,
  mapping: executorMappingSchema,
  workspaceRef: id4,
  workspaceMode: _enum(["existing", "independent_worktree"]),
  source: executionSourceSchema.optional(),
  goal: executionStartSchema.shape.goal,
  budget: executionStartSchema.shape.budget,
  deadlineAt: iso2
}).strict().refine((value) => value.workspaceMode !== "independent_worktree" || value.mapping.baseline.kind === "commit", "Independent worktree requires a commit").refine(bounded(EXECUTOR_LIMITS.launchBytes), "Launch exceeds byte budget");
var executorLaunchSchema = object({ assignment: executorAssignmentSchema, launchDigest: digest, remainingMs: positive.max(1200000), offlineGraceMs: literal(EXECUTOR_LIMITS.graceMs) }).strict();
var executorProcessIdentitySchema = object({
  bootId: string2().uuid(),
  unit: string2().regex(/^chrona-executor-[a-f0-9-]+\.service$/),
  invocationId: string2().regex(/^[a-f0-9]{32}$/),
  controlGroup: string2().min(1).max(1024).regex(/^\//).refine((value) => !value.split("/").some((part) => part === "." || part === "..") && !/[\0\r\n]/.test(value))
}).strict();
var executorStopProofSchema = discriminatedUnion("kind", [
  object({
    kind: literal("cgroup_empty"),
    identity: executorProcessIdentitySchema,
    observedAt: iso2,
    observer: _enum(["open_cgroup_events", "systemd_tracked"]),
    populated: literal(0),
    observationDigest: digest
  }).strict(),
  object({ kind: literal("never_started"), tombstoneDigest: digest }).strict(),
  object({ kind: literal("unknown"), reason: string2().min(1).max(500) }).strict()
]).refine(bounded(EXECUTOR_LIMITS.proofBytes), "Stop proof exceeds byte budget");
var executorDetailSchema = discriminatedUnion("type", [
  executionEventPayloadSchema.options[0],
  executionEventPayloadSchema.options[1],
  executionEventPayloadSchema.options[2],
  executionEventPayloadSchema.options[3],
  executionEventPayloadSchema.options[7]
]);
var executorSourceRecordSchema = object({ sourceSeq: positive, digest, at: iso2, item: discriminatedUnion("kind", [
  object({ kind: literal("detail"), payload: executorDetailSchema }).strict(),
  object({ kind: literal("progress"), value: providerProgressSchema }).strict(),
  object({ kind: literal("usage"), value: providerUsageSchema }).strict(),
  object({ kind: literal("resources"), value: providerResourcesSchema }).strict(),
  object({ kind: literal("gap"), throughSourceSeq: positive, reason: _enum(["truncated", "backpressure"]) }).strict()
]) }).strict().refine((value) => value.item.kind !== "gap" || value.item.throughSourceSeq >= value.sourceSeq, "Gap must cover its source position").refine(bounded(EXECUTOR_LIMITS.recordBytes), "Source record exceeds byte budget");
var executorControlSchema = discriminatedUnion("op", [
  object({ op: literal("cancel"), target: executorTargetSchema }).strict(),
  object({ op: literal("inject"), target: executorTargetSchema, commandKey: id4, text: string2().min(1).max(20000) }).strict()
]);
var executorQuestionReplySchema = discriminatedUnion("state", [
  object({ target: executorTargetSchema, questionKey: id4, requestId: id4, state: literal("answer"), answer: providerAnswerSchema }).strict(),
  object({ target: executorTargetSchema, questionKey: id4, requestId: id4, state: _enum(["pending", "interrupted"]) }).strict()
]);
var executorCleanupOperationSchema = object({
  target: executorTargetSchema,
  launchDigest: digest,
  workspaceRef: id4,
  mappingRevision: executorMappingSchema.shape.mappingRevision,
  sourceReceiptDigest: digest.nullable(),
  input: workCleanupInputSchema,
  requestDigest: digest
}).strict().refine((value) => value.target.workId === value.input.workId, "Cleanup work identity mismatch");
var executorCleanupResultSchema = object({ commandKey: id4, requestDigest: digest, receipt: workCleanupReceiptSchema }).strict();
var executorPollSchema = object({ ...request, waitMs: count2.max(EXECUTOR_LIMITS.pollMs) }).strict();
var executorPollReceiptSchema = executorFenceSchema.extend({
  authorizedForMs: count2.max(EXECUTOR_LIMITS.graceMs),
  launches: array(executorLaunchSchema).max(EXECUTOR_LIMITS.codingEnvironment),
  controls: array(executorControlSchema).max(EXECUTOR_LIMITS.controls),
  questions: array(executorQuestionReplySchema).max(6),
  cleanupOperations: array(executorCleanupOperationSchema).max(4).optional()
}).strict().refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Poll receipt exceeds byte budget");
var executorReportSchema = object({
  ...request,
  target: executorTargetSchema,
  records: array(executorSourceRecordSchema).max(EXECUTOR_LIMITS.records).refine(bounded(EXECUTOR_LIMITS.eventBytes), "Record batch exceeds byte budget"),
  started: object({ launchDigest: digest, identity: executorProcessIdentitySchema, sourceReceipt: executionSourceReceiptSchema.nullable() }).strict().optional(),
  consumed: array(object({ commandKey: id4, effect: _enum(["delivered", "unknown"]) }).strict()).max(EXECUTOR_LIMITS.controls).optional(),
  cleanupResults: array(executorCleanupResultSchema).max(4).optional()
}).strict().refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Report exceeds byte budget");
var executorReportReceiptSchema = object({ acceptedThroughSourceSeq: count2, storedHighWatermark: count2 }).strict();
var executorQuestionSchema = object({ ...request, target: executorTargetSchema, questionKey: id4, value: providerQuestionSchema }).strict();
var executorQuestionReceiptSchema = object({ target: executorTargetSchema, questionKey: id4, requestId: id4, state: _enum(["pending", "interrupted"]) }).strict();
var executorFinalSchema = executorTargetSchema.extend({
  throughSourceSeq: count2,
  baseline: workBaselineSchema,
  launchDigest: digest,
  outcome: object({ outcome: _enum(["finished", "failed", "timed_out", "unavailable"]), sessionId: id4.nullable(), error: string2().max(1000).nullable() }).strict(),
  finalMessage: executionSnapshotSchema.shape.finalMessage,
  missing: boolean2(),
  sourceReceipt: executionSourceReceiptSchema.nullable(),
  changes: executionChangesSchema.optional(),
  stop: executorStopProofSchema
}).strict().refine(bounded(EXECUTOR_LIMITS.finalBytes - 1024), "Final exceeds reserved envelope budget");
var executorFinalRequestSchema = object({ ...request, digest, final: executorFinalSchema }).strict().refine(bounded(EXECUTOR_LIMITS.finalBytes), "Final request exceeds byte budget");
var executorFinalReceiptSchema = object({ digest, accepted: literal(true), stopConfirmed: boolean2() }).strict();
var executorReconcileEntrySchema = object({
  target: executorTargetSchema,
  launchDigest: digest,
  phase: _enum(["intent", "owned", "started", "stopping", "unknown", "final"]),
  identity: executorProcessIdentitySchema.optional(),
  sourceAck: count2,
  finalDigest: digest.optional(),
  stop: executorStopProofSchema.optional()
}).strict();
var executorReconcileSchema = object({ ...request, entries: array(executorReconcileEntrySchema).max(EXECUTOR_LIMITS.reconcileEntries), after: id4.nullable(), complete: boolean2() }).strict().refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Reconciliation exceeds byte budget");
var executorReconcileReceiptSchema = executorFenceSchema.extend({ decisions: array(object({ target: executorTargetSchema, action: _enum(["stop", "report", "ack_final", "unknown"]) }).strict()).max(EXECUTOR_LIMITS.reconcileEntries), after: id4.nullable(), reconciled: boolean2() }).strict();
var executorBridgeSchema = object({ ...request, target: executorTargetSchema, call: discriminatedUnion("op", [
  object({ op: literal("progress"), value: providerProgressSchema }).strict(),
  object({ op: literal("usage"), value: providerUsageSchema }).strict(),
  object({ op: literal("resources"), value: providerResourcesSchema }).strict(),
  object({ op: literal("question"), questionKey: id4, value: providerQuestionSchema }).strict()
]) }).strict().refine(bounded(EXECUTOR_LIMITS.recordBytes), "Bridge request exceeds byte budget");
var executorJournalSchema = object({
  assignment: executorAssignmentSchema,
  launchDigest: digest,
  phase: _enum(["intent", "owned", "started", "stopping", "unknown", "final"]),
  identity: executorProcessIdentitySchema.nullable(),
  sourceAck: count2,
  sourceProduced: count2,
  consumedControls: array(object({ commandKey: id4, effect: _enum(["delivered", "unknown"]) }).strict()).max(EXECUTOR_LIMITS.controlReceipts),
  final: executorFinalSchema.nullable(),
  finalDigest: digest.nullable(),
  tombstoneDigest: digest.nullable()
}).strict().refine((value) => value.sourceAck <= value.sourceProduced && value.final === null === (value.finalDigest === null), "Journal positions or final digest disagree").refine((value) => (value.phase !== "final" || value.final !== null) && (!["owned", "started", "stopping"].includes(value.phase) || value.identity !== null), "Journal phase lacks its durable identity/final");
var EXECUTOR_HTTP = {
  pair: { method: "POST", path: "/api/executor/v1/pair", auth: "pair_credential", bytes: 4096 },
  poll: { method: "POST", path: "/api/executor/v1/poll", auth: "active", bytes: 4096 },
  report: { method: "POST", path: "/api/executor/v1/report", auth: "active", bytes: EXECUTOR_LIMITS.bodyBytes },
  question: { method: "POST", path: "/api/executor/v1/question", auth: "active", bytes: EXECUTOR_LIMITS.recordBytes },
  final: { method: "POST", path: "/api/executor/v1/final", auth: "active_or_drain", bytes: EXECUTOR_LIMITS.finalBytes },
  reconcile: { method: "POST", path: "/api/executor/v1/reconcile", auth: "active_or_drain", bytes: EXECUTOR_LIMITS.bodyBytes }
};
var executorOwnerPairSchema = object({ label: string2().trim().min(1).max(200) }).strict();
var executorOwnerRevokeSchema = executorIdentitySchema.extend({ commandKey: id4 }).strict();
var executorOwnerIncarnationSchema = executorIdentitySchema.extend({ expectedIncarnation: id4, nextIncarnation: id4, commandKey: id4 }).strict().refine((value) => value.expectedIncarnation !== value.nextIncarnation, "Incarnation must change");
var executorErrorEnvelopeSchema = object({ ...envelope, ok: literal(false), error: executionErrorSchema }).strict();
// packages/contracts/src/steward/local-runtime.ts
var runtimeOperationSchema = object({ operationId: string2().min(1).max(128) }).strict();
var runtimeOutcomeSchema = object({ outcome: _enum(["finished", "failed", "timed_out", "unavailable"]), sessionId: string2().nullable(), error: string2().nullable() }).strict();
var runtimeHealthSchema = object({ name: string2().min(1), supportsRunModel: boolean2(), complete: boolean2(), available: boolean2(), sandboxed: boolean2(), error: string2().nullable() }).strict();
var runtimeCompletionSchema = object({ text: string2(), inputTokens: number2().int().nonnegative().nullable(), outputTokens: number2().int().nonnegative().nullable() }).strict();
var runtimeTranscriptSchema = array(discriminatedUnion("kind", [
  object({ at: string2(), kind: literal("text"), text: string2() }).strict(),
  object({ at: string2(), kind: literal("tool"), tool: string2(), args: string2() }).strict(),
  object({ at: string2(), kind: literal("result"), tool: string2(), text: string2(), error: boolean2() }).strict()
])).max(300);
var runtimeImageSchema = object({ mime: string2().max(200), base64: string2().max(8 * 1024 * 1024) }).strict();
var runtimeStartSchema = object({
  operationId: runtimeOperationSchema.shape.operationId,
  runId: string2().min(1).max(128),
  token: string2().min(1).max(1024),
  lane: _enum(["foreground", "background", "build"]),
  cwd: string2().min(1).max(8192),
  sessionDir: string2().min(1).max(8192),
  sessionId: string2().nullable(),
  prompt: string2().max(2 * 1024 * 1024),
  systemPrompt: string2().max(200000),
  resources: _enum(["configured", "minimal"]),
  deadline: string2().datetime({ offset: true }),
  model: string2().max(500).optional(),
  images: array(runtimeImageSchema).max(10).optional(),
  extraTools: array(string2().max(200)).max(2000).optional(),
  searchTools: boolean2().optional(),
  hostPaths: array(string2().max(8192)).max(1000).optional(),
  content: array(object({ name: string2().max(200), dir: string2().max(8192), writable: boolean2() }).strict()).max(100).optional(),
  execution: executionRefSchema.optional(),
  executionBudget: object({ maxToolCalls: number2().int().positive() }).strict().optional(),
  callbacks: string2().uuid().optional()
}).strict();
var runtimeEventSchema = discriminatedUnion("kind", [
  object({ kind: literal("progress"), value: providerProgressSchema }).strict(),
  object({ kind: literal("usage"), value: providerUsageSchema }).strict(),
  object({ kind: literal("resources"), value: providerResourcesSchema }).strict(),
  object({ kind: literal("detail"), value: executionEventSchema }).strict(),
  object({ kind: literal("question"), requestId: string2().uuid(), value: providerQuestionSchema }).strict(),
  object({ kind: literal("interrupt"), requestId: string2().uuid() }).strict()
]);
// packages/contracts/src/steward/module-candidates.ts
var id5 = string2().min(1).max(128);
var requestKey = string2().trim().min(1).max(120);
var name = string2().regex(/^[a-z][a-z0-9-]*$/).max(64);
var relativeDir = string2().min(1).max(500).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.includes("\x00") && value.split("/").every((part) => part && part !== "." && part !== ".." && part !== ".git"), "Expected a relative content directory");
var candidateSubmitterSchema = object({ moduleId: id5, hash: moduleVersionHashSchema }).strict();
var candidateTargetSchema = object({ name, moduleId: id5.nullable(), expectedActiveHash: moduleVersionHashSchema.nullable() }).strict().refine((target) => target.moduleId !== null || target.expectedActiveHash === null, "New targets cannot have an active hash");
var candidateAdmissionInputSchema = object({ requestKey, submitter: candidateSubmitterSchema, targets: array(candidateTargetSchema).min(1).max(4) }).strict().refine((input) => new Set(input.targets.map((target) => target.name)).size === input.targets.length && new Set(input.targets.flatMap((target) => target.moduleId ? [target.moduleId] : [])).size === input.targets.filter((target) => target.moduleId).length, "Targets must be unique");
var candidateIntentSchema = object({ changes: array(string2().trim().min(1).max(500)).min(1).max(20), preserves: array(string2().trim().min(1).max(500)).max(20).default([]) }).strict();
var candidateSubmitInputSchema = object({ admissionId: id5, requestKey, items: array(object({ name, dir: relativeDir, intent: candidateIntentSchema }).strict()).min(1).max(4) }).strict().refine((input) => new Set(input.items.map((item) => item.name)).size === input.items.length, "Items must be unique");
var candidateSourceInputSchema = object({ admissionId: id5, moduleId: id5, hash: moduleVersionHashSchema, to: relativeDir }).strict();
var candidateCheckInputSchema = union([
  object({ receiptId: id5 }).strict(),
  object({ admissionId: id5, requestKey }).strict()
]);
var candidateAdmissionOutputSchema = object({ admissionId: id5, requestKey, submitter: candidateSubmitterSchema, targets: array(candidateTargetSchema).min(1).max(4) }).strict();
var candidateSourceOutputSchema = object({ moduleId: id5, hash: moduleVersionHashSchema, materialDigest: string2().regex(/^[a-f0-9]{64}$/) }).strict();
var candidateReceiptSchema = object({
  receiptId: id5,
  admissionId: id5,
  requestKey,
  submitter: candidateSubmitterSchema,
  state: _enum(["submitted", "pending_approval", "approved", "rejected"]),
  approvalId: id5.nullable(),
  members: array(object({ name, moduleId: id5, hash: moduleVersionHashSchema, versionId: id5, expectedActiveHash: moduleVersionHashSchema.nullable(), materialDigest: string2().regex(/^[a-f0-9]{64}$/), status: _enum(["building", "testing", "pending_review", "approved", "rejected"]), selected: boolean2() }).strict()).min(1).max(4)
}).strict();

// packages/contracts/src/steward/index.ts
var id6 = string2().trim().min(1).max(128);
var iso3 = string2().datetime({ offset: true }).max(40);
var short = string2().trim().min(1).max(200);
var text = string2().trim().min(1);
var hhmm = string2().regex(/^\d\d:\d\d$/);
var relativePathSchema = string2().trim().min(1).max(500).refine((p) => !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "" || s === ".git"), "invalid path");
var SESSION_SOURCES = ["web", "qq", "mcp", "rescue", "wake", "module", "build", "reflect"];
var SESSION_STATUSES = ["active", "ended"];
var RUN_LANES = ["foreground", "background", "build"];
var RUN_TRIGGERS = ["message", "schedule", "source", "edit", "approval", "retry", "build"];
var RUN_STATUSES = ["queued", "running", "finished", "failed", "timed_out", "cancelled", "provider_unavailable"];
var SCHEDULE_MODES = ["wake", "module"];
var SCHEDULE_STATUSES = ["active", "paused", "done", "cancelled"];
var APPROVAL_STATUSES = ["open", "approved", "denied", "expired"];
var APPROVAL_SCOPES = ["once"];
var ACTIONS = ["activate_module", "delete_data", "modify_external"];
var GRANT_MODES = ["allow", "ask"];
var DELIVERY_CHANNELS = ["in_app", "chrona_qqbot"];
var RUN_LIMITS = {
  foregroundTimeoutMs: 5 * 60000,
  backgroundTimeoutMs: 20 * 60000,
  buildTimeoutMs: 60 * 60000,
  maxChronaToolCalls: 60,
  maxRunsPerSessionPerDay: 24,
  maxRunsPerDay: 200,
  maxFailures: 3,
  jobTimeoutMs: 60000,
  jobOutputBytes: 64 * 1024,
  moduleTestMemoryMb: 2048,
  maxBuildRunsPerDay: 20,
  maxBuildSubmissionsPerRun: 5,
  maxQueuedBuilds: 10
};
var scheduleRuleSchema = discriminatedUnion("kind", [
  object({ kind: literal("at"), at: iso3 }).strict(),
  object({ kind: literal("daily"), time: hhmm }).strict(),
  object({ kind: literal("weekly"), days: array(number2().int().min(0).max(6)).min(1).max(7), time: hhmm }).strict(),
  object({ kind: literal("every"), minutes: number2().int().min(5).max(10080) }).strict()
]);
var MODULE_EFFECTS = ["network"];
var modelTier = string2().regex(/^[a-z][a-z0-9-]{1,20}$/);
var RESERVED_LISTEN_PATHS = ["/api/steward", "/api/workspaces", "/api/health"];
var interfaceRefSchema = string2().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/);
var listenPath = union([literal("/"), string2().regex(/^\/api\/[a-z][a-z0-9-]{1,40}$/)]);
var listenPaths = (manifest) => manifest.listen === undefined ? [] : typeof manifest.listen === "string" ? [manifest.listen] : [...manifest.listen];
var SECRET_NAME_SCHEMA = string2().regex(/^[a-z][a-z0-9_]{1,40}$/);
var SECRET_FIELD_NAME = string2().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/);
var secretLabel = string2().min(1).max(80);
var oauthEndpoint = string2().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
});
var secretSpecSchema = object({
  name: SECRET_NAME_SCHEMA,
  label: secretLabel.optional(),
  description: string2().max(500).optional(),
  fields: array(object({
    name: SECRET_FIELD_NAME,
    label: secretLabel,
    description: string2().max(300).optional(),
    optional: boolean2().optional(),
    plain: boolean2().optional()
  }).strict()).max(20).default([]),
  extraFields: object({ label: secretLabel, valueLabel: secretLabel, description: string2().max(300).optional() }).strict().optional(),
  oauth: object({
    provider: _enum(["google", "microsoft"]),
    scopes: array(string2().min(1).max(200)).min(1).max(20),
    accounts: boolean2().optional(),
    authorizationUrl: oauthEndpoint,
    tokenUrl: oauthEndpoint,
    authorizationParams: record(string2().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), string2().max(2000)).refine((value) => !Object.keys(value).some((key) => ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"].includes(key))).optional()
  }).strict().optional()
}).strict();
var moduleManifestSchema = object({
  name: slug,
  description: string2().min(1).max(300).optional(),
  entry: string2().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/),
  tools: array(moduleToolSchema).max(30).default([]),
  keepAlive: boolean2().default(false),
  activated: boolean2().default(false),
  content: boolean2().default(false),
  listen: union([listenPath, array(listenPath).min(1).max(4)]).optional(),
  uses: array(union([interfaceRefSchema, literal("*")])).max(40).default([]),
  packages: array(string2().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,80}$/)).max(20).default([]),
  secrets: array(union([SECRET_NAME_SCHEMA, secretSpecSchema])).max(50).default([]),
  model: object({ tier: modelTier, maxCalls: number2().int().min(1).max(20), maxOutputTokens: number2().int().min(1).max(32000) }).strict().optional(),
  effects: array(_enum(MODULE_EFFECTS)).max(MODULE_EFFECTS.length),
  params: record(slug, object({ type: _enum(["number", "string", "boolean"]), value: union([number2(), string2().max(2000), boolean2()]) }).strict()).default({}),
  limits: object({ virtualMemoryMb: number2().int().min(1024).max(8192) }).strict().optional(),
  data: object({ schema: number2().int().min(1), migrate: string2().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/).optional() }).strict().default({ schema: 1 }),
  tests: array(string2().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/)).min(1).max(10)
}).strict().superRefine((manifest, ctx) => {
  for (const [key, param] of Object.entries(manifest.params)) {
    if (typeof param.value !== param.type)
      ctx.addIssue({ code: "custom", path: ["params", key, "value"], message: "Value must match parameter type" });
  }
  if (!manifest.tools.length && !manifest.keepAlive)
    ctx.addIssue({ code: "custom", path: ["tools"], message: "A module needs a tool or keepAlive" });
  if (new Set(manifest.effects).size !== manifest.effects.length)
    ctx.addIssue({ code: "custom", path: ["effects"], message: "Effects must be unique" });
  const names = secretNames(manifest);
  if (new Set(names).size !== names.length)
    ctx.addIssue({ code: "custom", path: ["secrets"], message: "Secret names must be unique" });
  if (SYSTEM_MODULES.includes(manifest.name))
    ctx.addIssue({ code: "custom", path: ["name"], message: "Name is reserved for a Chrona system module" });
}).superRefine((manifest, ctx) => {
  if (new Set(manifest.uses).size !== manifest.uses.length)
    ctx.addIssue({ code: "custom", path: ["uses"], message: "Uses must be unique" });
  if (manifest.listen && !manifest.keepAlive)
    ctx.addIssue({ code: "custom", path: ["listen"], message: "listen requires keepAlive" });
  if (listenPaths(manifest).some((own) => RESERVED_LISTEN_PATHS.some((path) => own === path || own.startsWith(`${path}-`))))
    ctx.addIssue({ code: "custom", path: ["listen"], message: "Path is reserved by Chrona" });
  if (new Set(listenPaths(manifest)).size !== listenPaths(manifest).length)
    ctx.addIssue({ code: "custom", path: ["listen"], message: "Listen paths must be unique" });
  if (grantedUses(manifest).some((target) => target === "agent.complete") !== !!manifest.model)
    ctx.addIssue({ code: "custom", path: ["model"], message: "Declare model limits exactly when the module uses agent.complete" });
  const names = new Set;
  manifest.tools.forEach((tool, index) => {
    if (names.has(tool.name))
      ctx.addIssue({ code: "custom", path: ["tools", index, "name"], message: "Tool names must be unique" });
    names.add(tool.name);
    if (new Set(tool.visibility).size !== tool.visibility.length)
      ctx.addIssue({ code: "custom", path: ["tools", index, "visibility"], message: "Visibility must be unique" });
    for (const key of tool.parameters.required)
      if (!(key in tool.parameters.properties))
        ctx.addIssue({ code: "custom", path: ["tools", index, "parameters", "required"], message: `Required parameter ${key} is not in properties` });
  });
});
var channelId = string2().min(1).max(64);
var moduleResultSchema = json().optional().refine((value) => value === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262144, "result must serialize to at most 256 KiB");
var CALL_STATUSES = ["queued", "running", "waiting", "succeeded", "failed", "unknown"];
var callerSchema = discriminatedUnion("kind", [
  object({ kind: literal("module"), module: slug, moduleId: string2().max(128), hash: string2().max(64) }).strict(),
  object({ kind: literal("provider"), runId: string2().max(128) }).strict(),
  object({ kind: literal("owner"), via: slug.nullable() }).strict(),
  object({ kind: literal("kernel") }).strict(),
  object({ kind: literal("system"), module: slug }).strict()
]);
var moduleEventSchema = object({
  trigger: discriminatedUnion("kind", [
    object({ kind: literal("schedule"), id: slug, firedAt: iso3, scheduleId: string2().max(128).optional(), payload: record(string2(), unknown()).optional() }).strict(),
    object({
      kind: literal("tool"),
      id: slug,
      firedAt: iso3,
      args: record(string2(), unknown()),
      caller: callerSchema.optional(),
      call: object({ id: string2().max(128), key: string2().max(500).nullable(), attempt: number2().int().min(1), chain: array(slug).max(16) }).strict().optional()
    }).strict(),
    object({
      kind: literal("call_result"),
      id: literal("call"),
      firedAt: iso3,
      callId: string2().max(128),
      target: interfaceRefSchema,
      key: string2().max(500),
      status: _enum(["succeeded", "failed", "unknown"]),
      output: json().optional(),
      error: string2().max(2000).optional()
    }).strict(),
    object({ kind: literal("activated"), id: literal("activated"), firedAt: iso3 }).strict()
  ]),
  now: iso3,
  params: record(string2(), union([number2(), string2(), boolean2()]))
}).strict();
var moduleEventMessageSchema = object({ id: channelId, event: moduleEventSchema }).strict();
var MODULE_CALL_ERRORS = [
  "undeclared",
  "invalid",
  "internal",
  "forbidden",
  "not_found",
  "conflict",
  "cycle",
  "unknown",
  "failed",
  "unavailable",
  "reauthorize",
  "unauthorized",
  "cursor_expired",
  "too_large",
  "capacity",
  "unsupported_version",
  "unsupported",
  "unconfigured",
  "budget_exceeded",
  "provider_error",
  "timeout"
];
var moduleEventReplySchema = object({ id: channelId, result: object({ handled: boolean2().optional(), result: moduleResultSchema }).strict().default({}) }).strict().or(object({ id: channelId, error: string2().max(2000), errorCode: _enum(MODULE_CALL_ERRORS).optional() }).strict());
var secretNames = (manifest) => (manifest.secrets ?? []).map((secret) => typeof secret === "string" ? secret : secret.name);
var SECRET_TARGETS = ["secrets.get", "secrets.authorize", "secrets.token"];
function grantedUses(manifest) {
  return [...new Set([...manifest.uses ?? [], ...manifest.secrets?.length ? SECRET_TARGETS : []])];
}
var SYSTEM_MODULES = ["approvals", "modules", "settings", "secrets", "activity"];
var expectedModuleTargetSchema = object({ moduleId: string2().min(1), contractHash: string2().regex(/^[a-f0-9]{64}$/) }).strict();
var moduleCallSchema = discriminatedUnion("method", [
  object({ id: channelId, method: literal("call"), params: object({
    target: interfaceRefSchema,
    args: record(string2(), json()).default({}),
    mode: _enum(["sync", "async"]).default("sync"),
    key: string2().min(1).max(200).optional(),
    reply: boolean2().default(false),
    timeoutMs: number2().int().min(1000).max(600000).optional(),
    expectedTarget: expectedModuleTargetSchema.optional()
  }).strict().refine((params) => params.mode === "sync" || params.key !== undefined, "async calls need a key") }).strict(),
  object({ id: channelId, method: literal("callStatus"), params: object({ callId: string2().min(1).max(128) }).strict() }).strict()
]);
var moduleCallReplySchema = object({ id: channelId, result: union([
  object({ output: json() }).strict(),
  object({ callId: string2().max(128), status: _enum(CALL_STATUSES), duplicate: boolean2().optional(), output: json().optional(), error: string2().max(2000).optional() }).strict()
]) }).strict().or(object({ id: channelId, error: object({ code: _enum(MODULE_CALL_ERRORS), message: string2().max(500) }).strict() }).strict());
var scheduleSchema = object({
  id: id6,
  mode: _enum(SCHEDULE_MODES),
  rule: scheduleRuleSchema,
  text: string2().max(4000),
  originSessionId: id6.nullable(),
  moduleId: id6.nullable(),
  until: iso3.nullable(),
  status: _enum(SCHEDULE_STATUSES),
  nextAt: iso3.nullable(),
  lastAt: iso3.nullable(),
  lastResult: string2().max(2000).nullable(),
  label: string2().max(80).nullable(),
  createdBy: _enum(["user", "chrona", "module"]),
  createdAt: iso3
}).strict();
var sessionSchema = object({
  id: id6,
  key: string2().max(200),
  source: _enum(SESSION_SOURCES),
  title: string2().max(200).nullable(),
  status: _enum(SESSION_STATUSES),
  moduleId: id6.nullable(),
  originSessionId: id6.nullable(),
  focus: array(slug).max(10),
  running: boolean2(),
  lastActivityAt: iso3,
  createdAt: iso3,
  endedAt: iso3.nullable()
}).strict();
var appSchema = object({
  id: id6,
  name: slug,
  description: string2().max(300).nullable(),
  status: _enum(["active", "paused"]),
  builtin: boolean2(),
  activeHash: string2().max(64).nullable(),
  origin: moduleOriginSchema,
  capabilities: moduleCapabilitiesSchema
}).strict();
var runSchema = object({
  id: id6,
  sessionId: id6.nullable(),
  lane: _enum(RUN_LANES),
  trigger: _enum(RUN_TRIGGERS),
  status: _enum(RUN_STATUSES),
  provider: short,
  toolCalls: array(object({ tool: short, at: iso3, ok: boolean2() }).strict()).max(200),
  error: string2().max(1000).nullable(),
  startedAt: iso3.nullable(),
  endedAt: iso3.nullable(),
  createdAt: iso3,
  label: string2().max(80).nullable()
}).strict();
var contentRefSchema = string2().trim().min(3).max(542).regex(/^(?!chat\/)[a-z][a-z0-9-]{1,40}\//, "starts with an application name").refine((ref) => relativePathSchema.safeParse(ref.slice(ref.indexOf("/") + 1)).success, "invalid path");
var attachmentSchema = object({ name: short, ref: contentRefSchema.nullable(), mime: string2().max(100), size: number2().int().min(0) }).strict();
var messageSchema = object({
  id: id6,
  sessionId: id6,
  direction: _enum(["in", "out"]),
  channel: _enum(DELIVERY_CHANNELS),
  text: string2().max(8000),
  attachments: array(attachmentSchema).max(10),
  quotedMessageId: id6.nullable(),
  at: iso3
}).strict();
var approvalSchema = object({
  id: id6,
  action: _enum(ACTIONS),
  moduleId: id6.nullable(),
  title: short,
  detail: string2().max(4000),
  preview: string2().max(20000),
  status: _enum(APPROVAL_STATUSES),
  createdAt: iso3,
  resolvedAt: iso3.nullable()
}).strict();
var grantScopeSchema = discriminatedUnion("kind", [
  object({ kind: literal("global") }).strict(),
  object({ kind: literal("module"), moduleId: id6 }).strict()
]);
var grantSchema = object({
  id: id6,
  action: _enum(ACTIONS),
  mode: _enum(GRANT_MODES),
  scope: grantScopeSchema,
  once: boolean2(),
  consumedAt: iso3.nullable(),
  expiresAt: iso3.nullable(),
  createdAt: iso3,
  revokedAt: iso3.nullable()
}).strict();
var policyDecisionSchema = object({ action: _enum(ACTIONS), mode: _enum(GRANT_MODES), grantId: id6.nullable(), reason: string2().max(500) }).strict();
var PREFERENCE_TOPICS = ["general", "ui"];
var preferenceSchema = object({ id: id6, text: text.max(500), origin: _enum(["said", "learned"]), topic: _enum(PREFERENCE_TOPICS), createdAt: iso3, lastUsedAt: iso3.nullable() }).strict();
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var moduleModelSettingsSchema = object({
  maxCallsPerEvent: number2().int().min(1).max(20),
  maxOutputTokens: number2().int().min(1).max(32000),
  dailyCalls: number2().int().min(1).max(1e4),
  eventTimeoutMs: number2().int().min(5000).max(600000),
  moduleDailyCalls: record(slug, number2().int().min(0).max(1e4)).optional()
}).strict();
var buildSettingsSchema = object({
  dailyLimit: number2().int().min(0).max(200),
  timeoutMinutes: number2().int().min(5).max(120),
  maxSubmissions: number2().int().min(1).max(20)
}).strict();
var settingsSchema = object({
  timezone: string2().min(1).max(80),
  modelUsage: array(object({ module: string2(), calls: number2().int().min(0), inputTokens: number2().int().min(0), outputTokens: number2().int().min(0) }).strict()),
  moduleModel: moduleModelSettingsSchema.nullable()
}).strict();
var healthSchema = object({
  provider: object({ name: short, available: boolean2(), sandboxed: boolean2(), lastError: string2().max(500).nullable() }).strict(),
  moduleSandbox: boolean2(),
  queuedRuns: number2().int().min(0),
  runningRuns: number2().int().min(0),
  failedRunsToday: number2().int().min(0),
  lastTickAt: iso3.nullable()
}).strict();
var resolveApprovalSchema = object({ decision: _enum(["approve", "deny"]), scope: _enum(APPROVAL_SCOPES).default("once") }).strict();
var createGrantSchema = object({ action: _enum(ACTIONS), mode: _enum(GRANT_MODES), scope: grantScopeSchema, expiresAt: iso3.optional() }).strict();
var updateSettingsSchema = object({ timezone: string2().min(1).max(80).optional(), moduleModel: moduleModelSettingsSchema.nullable().optional() }).strict();
var chronaToolInputSchemas = {
  chrona_reply: object({ text: text.max(8000), files: array(relativePathSchema).max(10).default([]).describe("Files written in this build's actual working directory, copied into the receiving application's content; at most 20 MiB each.") }).strict()
};
var modulesToolInputSchemas = {
  reference: object({ target: string2().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/).optional() }).strict().describe("Read development reference only: without target, list available interfaces (target, source, one-line description); with <module>.<tool>, get its input schema, declared output schema/examples and admission rules. Never executes the target or reads its business data. Undeclared outputs are explicitly unknown, not inferred from empty results."),
  rollback: object({ module: slug, hash: moduleVersionHashSchema }).strict().describe('Roll back to a previously approved version. May return { status: "pending_approval", approvalId } when restoring a data snapshot needs user approval.')
};
var CHRONA_TOOLS = Object.keys(chronaToolInputSchemas);

// packages/integrations/src/steward/pi-provider.ts
import { join as join5, resolve as resolve3 } from "path";
import { createHash } from "crypto";
import { existsSync as existsSync2, mkdtempSync, readFileSync as readFileSync2, rmSync, symlinkSync as symlinkSync2, writeFileSync } from "fs";
import { stripVTControlCharacters } from "util";

// packages/domain/src/steward/provider.ts
function providerText(value, secrets = [], limit = 2000, multiline = false) {
  let text = typeof value === "string" ? value : "";
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.replaceAll(secret, "[redacted]");
  return text.replace(/\p{Cc}\[[0-?]*[ -/]*[@-~]/gu, "").replace(/\r\n?/g, `
`).replace(/[\p{Cc}\p{Cf}]/gu, (char) => multiline && (char === `
` || char === "\t") ? char : " ").replace(/\b(?:sk-[\w-]{12,}|Bearer\s+[^\s,;]+)/gi, "[redacted]").replace(/((?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]").slice(0, limit);
}
function safeProviderQuestion(raw, secrets = []) {
  const question = { ...raw, title: providerText(raw.title, secrets, 200), message: providerText(raw.message, secrets), options: raw.options.map((option) => providerText(option, secrets, 300)), ...raw.prefill === undefined ? {} : { prefill: providerText(raw.prefill, secrets, 8000, true) } };
  if ([question.title, question.message, question.prefill ?? "", ...question.options].some((text) => text.includes("[redacted]")))
    return null;
  return question;
}
function validProviderAnswer(question, answer) {
  if (answer.decision === "cancel")
    return true;
  if (question.method === "confirm")
    return typeof answer.value === "boolean";
  if (question.method === "select")
    return typeof answer.value === "number" && Number.isInteger(answer.value) && answer.value >= 0 && answer.value < question.options.length;
  return typeof answer.value === "string" && answer.value.length <= 8000;
}
function providerToolPhase(name) {
  const tool = typeof name === "string" && /^[\w:.-]{1,100}$/.test(name) ? name : null;
  const phases = new Map([["read", "reading"], ["grep", "reading"], ["find", "reading"], ["ls", "reading"], ["edit", "writing"], ["write", "writing"], ["web_search", "searching"], ["fetch_content", "searching"], ["bash", "executing"]]);
  const phase = tool ? phases.get(tool) ?? "executing" : "executing";
  return { phase, tool };
}
function providerUsage(current, baseline) {
  const parse = (value) => {
    if (!value || typeof value !== "object")
      return null;
    const raw = value;
    const parsed = providerUsageSchema.safeParse({ scope: "session", ...raw.tokens, cost: raw.cost, contextTokens: raw.contextUsage?.tokens ?? null, contextWindow: raw.contextUsage?.contextWindow ?? null });
    return parsed.success ? parsed.data : null;
  };
  const sessionId = (value) => value && typeof value === "object" && ("sessionId" in value) && typeof value.sessionId === "string" ? value.sessionId : null;
  const now = parse(current), before = parse(baseline);
  if (!now)
    return null;
  const sameSession = sessionId(current) !== null && sessionId(current) === sessionId(baseline);
  const keys = ["input", "output", "cacheRead", "cacheWrite", "total", "cost"];
  if (!before || !sameSession || keys.some((key) => now[key] < before[key]))
    return now;
  const result = { ...now, scope: "run" };
  for (const key of keys)
    result[key] = now[key] - before[key];
  return result;
}

// packages/integrations/src/steward/pi-events.ts
class PiEvents {
  input;
  secrets;
  write;
  fail;
  baseline;
  queue = Promise.resolve();
  controller = new AbortController;
  dialogs = new Map;
  progressCount = 0;
  constructor(input, secrets, write, fail) {
    this.input = input;
    this.secrets = secrets;
    this.write = write;
    this.fail = fail;
  }
  get waiting() {
    return this.dialogs.size > 0;
  }
  track(action) {
    this.queue = this.queue.then(action).catch(() => {});
  }
  progress(phase, tool = null) {
    if (!this.input.events || ++this.progressCount > 250)
      return;
    this.track(() => this.input.events.progress({ phase, tool }));
  }
  receive(event) {
    if (this.controller.signal.aborted)
      return;
    if (event.type === "agent_start" || event.type === "tool_execution_end")
      this.progress("thinking");
    if (event.type === "auto_retry_start" || event.type === "compaction_start" || event.type === "summarization_retry_scheduled")
      this.progress("recovering");
    if (event.type === "tool_execution_start") {
      const { phase, tool } = providerToolPhase(providerText(event.toolName, this.secrets, 100));
      this.progress(phase, tool);
    }
    if (event.type === "extension_ui_request")
      this.interaction(event);
  }
  interaction(event) {
    if (!["select", "confirm", "input", "editor"].includes(String(event.method)))
      return;
    if (!this.input.events) {
      this.fail("Pi interaction is not connected to Chrona");
      return;
    }
    const id = event.id;
    if (typeof id !== "string" || !id || id.length > 200 || this.dialogs.size >= 3) {
      this.fail("Invalid Pi interaction");
      return;
    }
    if (this.dialogs.has(id))
      return;
    const input = this.parseQuestion(event);
    if (!input) {
      this.fail("Invalid or expired Pi interaction");
      return;
    }
    this.progress("waiting");
    const task = this.answer(id, input.question, input.options).catch(() => {
      if (!this.controller.signal.aborted)
        this.fail("Could not complete Pi interaction");
    }).finally(() => {
      this.dialogs.delete(id);
    });
    this.dialogs.set(id, task);
  }
  parseQuestion(event) {
    const remaining = this.input.deadline.getTime() - Date.now();
    const timeout = typeof event.timeout === "number" && Number.isFinite(event.timeout) ? event.timeout : 300000;
    const parsed = providerQuestionSchema.safeParse({ method: event.method, title: event.title ?? "Pi", message: event.message ?? event.placeholder ?? "", options: event.options ?? [], prefill: event.method === "editor" ? event.prefill : undefined, timeoutMs: Math.floor(Math.min(300000, timeout, remaining)) });
    if (!parsed.success)
      return null;
    const question = safeProviderQuestion(parsed.data, this.secrets);
    return question ? { question, options: parsed.data.options } : null;
  }
  async answer(id, question, options) {
    const answer = await this.input.events.question(question, this.controller.signal);
    if (this.controller.signal.aborted)
      return;
    await this.write({ type: "extension_ui_response", id, ...this.response(question, answer, options) });
    this.progress("thinking");
  }
  response(question, answer, options) {
    if (!validProviderAnswer(question, answer))
      throw new Error("Invalid Pi interaction response");
    if (answer.decision === "cancel")
      return { cancelled: true };
    if (question.method === "confirm")
      return { confirmed: answer.value };
    if (question.method === "select" && typeof answer.value === "number")
      return { value: options[answer.value] };
    return { value: answer.value };
  }
  async initialize(inspect) {
    if (!this.input.events)
      return;
    try {
      this.baseline = await inspect();
    } catch {}
  }
  async collect(inspect) {
    if (!this.input.events)
      return;
    try {
      const value = providerUsage(await inspect(), this.baseline);
      if (value)
        this.track(() => this.input.events.usage(value));
    } catch {}
    await this.queue;
  }
  async resources(version, commands, extensions) {
    if (!this.input.events)
      return;
    const skills = Array.isArray(commands) ? commands.filter((command) => command.source === "skill").map((command) => providerText(command.name, this.secrets, 100)).slice(0, 50) : [];
    this.track(() => this.input.events.resources({ version, skills, extensions }));
    await this.queue;
  }
  interrupt() {
    this.controller.abort();
  }
  async close() {
    this.interrupt();
    await Promise.allSettled([...this.dialogs.values(), this.queue]);
  }
}

// packages/integrations/src/steward/pi-session-resume.ts
import { open, readdir } from "fs/promises";
import { isAbsolute, join, resolve } from "path";
var HEADER_LIMIT = 1024 * 1024;
async function sessionHeader(path) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_LIMIT);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, Math.min(4096, buffer.length - length), null);
      if (!bytesRead)
        return JSON.parse(buffer.subarray(0, length).toString("utf8"));
      const newline = buffer.subarray(length, length + bytesRead).indexOf(10);
      if (newline !== -1)
        return JSON.parse(buffer.subarray(0, length + newline).toString("utf8"));
      length += bytesRead;
    }
    throw new Error("Pi session header exceeds the read limit");
  } finally {
    await file.close();
  }
}
async function validatePiSessionResume(input) {
  let entries;
  try {
    entries = await readdir(input.sessionDir, { withFileTypes: true });
  } catch {
    return "Pi resume context is missing or unreadable";
  }
  let mismatchedCwd = false;
  for (const entry of entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))) {
    let header;
    try {
      header = await sessionHeader(join(input.sessionDir, entry.name));
    } catch {
      continue;
    }
    if (header?.type !== "session" || header.id !== input.sessionId)
      continue;
    if (typeof header.cwd === "string" && isAbsolute(header.cwd) && resolve(header.cwd) === resolve(input.cwd))
      return null;
    mismatchedCwd = true;
  }
  return mismatchedCwd ? "Pi resume context cwd does not match the authorized working directory" : "Pi resume context is missing or invalid for the requested session ID";
}

// packages/integrations/src/steward/pi-transcript.ts
import { readdir as readdir2, readFile } from "fs/promises";
import { join as join2 } from "path";
function items(entry) {
  const message = entry.message, at = entry.timestamp ?? "";
  if (entry.type !== "message" || !message)
    return [];
  const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content.filter((block) => block !== null && typeof block === "object") : [];
  if (message.role === "assistant")
    return blocks.flatMap((block) => {
      if (block.type === "text" && block.text?.trim())
        return [{ at, kind: "text", text: block.text.trim() }];
      if (block.type === "toolCall" && block.name)
        return [{ at, kind: "tool", tool: block.name, args: JSON.stringify(block.arguments ?? {}) }];
      return [];
    });
  if (message.role !== "toolResult")
    return [];
  return [{ at, kind: "result", tool: message.toolName ?? "", text: blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join(`
`), error: message.isError === true }];
}
async function piTranscript({ sessionDir, limit }) {
  const files = (await readdir2(sessionDir, { recursive: true }).catch((error) => {
    if (error.code === "ENOENT")
      return [];
    throw error;
  })).filter((name) => name.endsWith(".jsonl")).sort();
  const result = [];
  for (const file of files)
    for (const line of (await readFile(join2(sessionDir, file), "utf8")).split(`
`)) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry && typeof entry === "object")
        result.push(...items(entry));
    }
  return result.slice(-limit);
}

// packages/integrations/src/steward/pi-model-gateway.ts
import { spawn as spawn2 } from "child_process";
import { mkdtemp, readFile as readFile2, rm, writeFile } from "fs/promises";
import { join as join4 } from "path";
import { tmpdir } from "os";

// packages/integrations/src/steward/pi-launch.ts
import { spawn, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync as realpathSync2, statSync as statSync2, symlinkSync, unlinkSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute as isAbsolute3, join as join3, relative as relative2, resolve as resolve2, sep as sep2 } from "path";

// packages/integrations/src/steward/pi-resources.ts
import { readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute as isAbsolute2, relative, sep } from "path";
var name2 = string2().regex(/^[\w:.-]{1,100}$/);
var piResourcesSchema = object({
  skills: array(string2().min(1).max(2000)).max(30).default([]),
  extensions: array(string2().min(1).max(2000)).max(20).default([]),
  tools: array(name2).max(100).default([])
}).strict();
var builtins = new Set(["builtin:mcp", "builtin:codemode", "builtin:tool-search"]);
var empty = () => ({ skills: [], extensions: [], tools: [] });
function within(parent, file) {
  const path = relative(parent, file);
  return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute2(path);
}
function entry(path, roots) {
  if (!isAbsolute2(path) || realpathSync(path) !== path || roots.some((root) => within(root, path)))
    throw new Error("Unsafe Pi resource path");
  const stat = statSync(path);
  if (!stat.isFile() || process.platform !== "win32" && (stat.mode & 18) !== 0)
    throw new Error("Unsafe Pi resource file");
}
function readPiResources(file, profile, workspace) {
  if (file === undefined)
    return { resources: empty(), error: null };
  try {
    const roots = [profile, workspace].filter((root) => !!root && isAbsolute2(root));
    entry(file, roots);
    if (process.platform !== "win32" && (statSync(file).mode & 63) !== 0 || statSync(file).size > 32000)
      throw new Error("Manifest must be private and bounded");
    const resources = piResourcesSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    for (const skill of resources.skills) {
      entry(skill, roots);
      if (!skill.endsWith(".md"))
        throw new Error("Skill must be an explicit Markdown file");
    }
    for (const extension of resources.extensions)
      if (!builtins.has(extension))
        entry(extension, roots);
    return { resources: { skills: [...new Set(resources.skills)], extensions: [...new Set(resources.extensions)], tools: [...new Set(resources.tools)] }, error: null };
  } catch {
    return { resources: empty(), error: "Pi resource manifest must be a private canonical JSON file with reviewed external entry files" };
  }
}
var modernPi = (version) => {
  const m = /^1\.(\d+)\.\d+$/.exec(version);
  return !!m && Number(m[1]) >= 3;
};
function resourceVersionError(resources, version) {
  if (resources.extensions.some((value) => builtins.has(value)) && !modernPi(version))
    return "Native Pi builtins require a Pi 1.x pin of 1.3.0 or later";
  return null;
}
function resourceCommand(resources, source, path, baseExtensions) {
  if (typeof path !== "string")
    return false;
  if (source === "extension" && builtins.has(path))
    return resources.extensions.includes(path);
  try {
    if (!isAbsolute2(path))
      return false;
    const candidates = source === "extension" ? [...baseExtensions, ...resources.extensions.filter((value) => !builtins.has(value))] : source === "skill" ? resources.skills : [];
    const canonical = realpathSync(path);
    return candidates.some((candidate) => realpathSync(candidate) === canonical);
  } catch {
    return false;
  }
}

// packages/integrations/src/steward/pi-launch.ts
var inside = (parent, child) => {
  const path = relative2(parent, child);
  return path === "" || path !== ".." && !path.startsWith(`..${sep2}`) && !isAbsolute3(path);
};
var profileOverlaps = (profile, work) => inside(profile, work) || inside(work, profile);
function piLaunchConfig(options) {
  const selected = readPiResources(options.resourcesFile, options.agentDir ?? "", options.workspaceRoot);
  const configuredBwrap = options.bwrap ? options.bwrap.includes("/") ? resolve2(options.bwrap) : options.bwrap : null;
  return {
    options,
    command: options.command ?? "",
    agentDir: options.agentDir ?? "",
    version: options.expectedVersion ?? "0.85.0",
    resources: selected.resources,
    resourceError: selected.error,
    extension: resolve2(options.chronaExtension),
    web: options.webExtension ? resolve2(options.webExtension) : null,
    browserExtension: options.browserExtension ? resolve2(options.browserExtension) : null,
    bwrap: options.executionMode === "required-isolation" ? configuredBwrap : null
  };
}
function privateProfile(path) {
  try {
    const stat = statSync2(path);
    return stat.isDirectory() && realpathSync2(path) === path && (process.platform === "win32" || (stat.mode & 63) === 0);
  } catch {
    return false;
  }
}
function configurationError(config) {
  if (!isAbsolute3(config.command))
    return "Configure an absolute, service-specific Pi executable";
  if (!isAbsolute3(config.agentDir) || !privateProfile(config.agentDir))
    return "Pi profile must be an existing private canonical directory";
  if (config.options.workspaceRoot && profileOverlaps(config.agentDir, resolve2(config.options.workspaceRoot)))
    return "Pi profile must be separate from the session workspace";
  if (config.version !== "0.85.0" && !modernPi(config.version))
    return "Unsupported Pi version pin";
  if (config.resourceError)
    return config.resourceError;
  const resourceError = resourceVersionError(config.resources, config.version);
  if (resourceError)
    return resourceError;
  const extensions = [[config.extension, "Chrona tools extension missing"], [config.web, "Pi web extension missing"], [config.browserExtension, "Pi browser extension missing"]];
  return extensions.find(([path]) => path && !existsSync(path))?.[1] ?? null;
}
var PI_MODEL_ENVIRONMENT_KEYS = ["SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY"];
function piEnvironment(config) {
  const allowed = ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", ...PI_MODEL_ENVIRONMENT_KEYS];
  return { ...Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])), PI_CODING_AGENT_DIR: config.agentDir };
}
async function probe(command, env) {
  return new Promise((resolveProbe) => {
    let output = "";
    try {
      const child = spawn(command, ["--version"], { env, stdio: ["ignore", "pipe", "ignore"], shell: false });
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.stdout.on("data", (chunk) => {
        output = (output + chunk.toString("utf8")).slice(-256);
      });
      child.once("error", () => {
        clearTimeout(timer);
        resolveProbe({ ok: false, version: "" });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolveProbe({ ok: code === 0, version: output.trim() });
      });
    } catch {
      resolveProbe({ ok: false, version: "" });
    }
  });
}
async function inspectPiLaunch(config) {
  const invalid = configurationError(config);
  if (invalid)
    return invalid;
  const env = piEnvironment(config), pi = await probe(config.command, env);
  if (!pi.ok)
    return "Pi binary unavailable";
  if (pi.version !== config.version)
    return "Pi version does not match the configured pin";
  if (config.options.executionMode === "required-isolation") {
    const shell = Bun.which("sh");
    if (!config.bwrap || !(await probe(config.bwrap, env)).ok || !shell || spawnSync(config.bwrap, ["--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "--", shell, "-c", "exit 0"], { env: {}, timeout: 3000, stdio: "ignore" }).status !== 0)
      return "\u8981\u6C42\u9694\u79BB\u6267\u884C\uFF0C\u4F46 bubblewrap \u4E0D\u53EF\u7528";
  }
  return null;
}
var both = (p) => {
  const path = resolve2(p);
  return existsSync(path) ? [path, realpathSync2(path)] : [path];
};
function hostMounts(config, input) {
  const granted = (input.hostPaths ?? []).filter((p) => isAbsolute3(p) && existsSync(p)).flatMap((p) => ["--bind", p, p]);
  const data = granted.length && config.options.dataDir ? [...new Set(both(config.options.dataDir))] : [];
  return [...granted, ...data.flatMap((p) => ["--tmpfs", p])];
}
function workspaceMounts(input, cwd) {
  if (realpathSync2(cwd) !== cwd || realpathSync2(resolve2(input.sessionDir)) !== resolve2(input.sessionDir))
    throw new Error("Unsafe session directory");
  return ["--bind", cwd, cwd, "--bind", resolve2(input.sessionDir), resolve2(input.sessionDir)];
}
function contentAreas(input) {
  return (input.content ?? []).map((area) => {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(area.name) || !isAbsolute3(area.dir) || realpathSync2(area.dir) !== area.dir)
      throw new Error("Unsafe content mount");
    return area;
  });
}
function prepareContent(input, link) {
  const root = join3(resolve2(input.cwd), "content"), areas = contentAreas(input);
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(root, { withFileTypes: true }))
    if (entry.isSymbolicLink())
      unlinkSync(join3(root, entry.name));
  if (link) {
    for (const area of areas)
      if (!existsSync(join3(root, area.name)))
        symlinkSync(area.dir, join3(root, area.name));
  }
}
function optionalExtensions(config, browser) {
  return [
    ...config.web ? [{ extension: config.web, tools: ["web_search", "fetch_content"], files: [config.web] }] : [],
    ...browser && config.browserExtension ? [{ extension: config.browserExtension, tools: ["browser_screenshot"], files: [config.browserExtension, dirname(browser)] }] : []
  ];
}
function piTools(config, input, optional) {
  return [...new Set([
    "read",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "bash",
    ...input.resources === "configured" ? CHRONA_TOOLS : [],
    ...optional.flatMap((extension) => extension.tools),
    ...input.resources === "configured" ? config.resources.tools : [],
    ...(input.extraTools ?? []).filter((name) => /^m_[a-z0-9_]{1,62}$/.test(name)),
    ...input.searchTools ? ["tool_search", "m_*"] : []
  ])].join(",");
}
function configuredResourceFiles(config, input) {
  return input.resources === "configured" ? [...config.resources.extensions, ...config.resources.skills] : [];
}
function piArguments(config, input, prompt, browser = null) {
  const optional = input.resources === "configured" ? optionalExtensions(config, browser) : [];
  const args = [
    "--mode",
    "rpc",
    "--session-dir",
    resolve2(input.sessionDir),
    "--session-id",
    input.sessionId ?? randomUUID(),
    "--no-approve",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    "-e",
    config.extension
  ];
  for (const { extension } of optional)
    args.push("-e", extension);
  if (input.searchTools)
    args.push("-e", "builtin:tool-search");
  if (input.resources === "configured") {
    for (const extension of config.resources.extensions)
      args.push("-e", extension);
    for (const skill of config.resources.skills)
      args.push("--skill", skill);
  }
  args.push("--tools", piTools(config, input, optional), "--append-system-prompt", prompt);
  const model = input.model ?? config.options.model;
  if (model)
    args.push("--model", model);
  if (!config.bwrap)
    return args;
  const cwd = resolve2(input.cwd);
  const hidden = [...new Set([homedir(), config.options.dataDir].filter((p) => !!p).flatMap(both))].sort((a, b) => a.split(sep2).length - b.split(sep2).length);
  const resources = [config.command, config.extension, ...optional.flatMap((extension) => extension.files), ...configuredResourceFiles(config, input)].filter((p) => !!p && isAbsolute3(p));
  const visible = [...new Set(resources.flatMap((p) => existsSync(p) ? [p, realpathSync2(p)] : [p]))].filter((p) => hidden.some((root) => inside(root, p)));
  const root = readdirSync("/").filter((name) => !["proc", "dev", "tmp"].includes(name)).flatMap((name) => ["--ro-bind", `/${name}`, `/${name}`]);
  return [
    "--die-with-parent",
    "--tmpfs",
    "/",
    ...root,
    "--tmpfs",
    "/tmp",
    ...hidden.flatMap((p) => ["--tmpfs", p]),
    ...hostMounts(config, input),
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    ...visible.flatMap((p) => ["--ro-bind", p, p]),
    ...workspaceMounts(input, cwd),
    ...contentAreas(input).flatMap((area) => [area.writable ? "--bind" : "--ro-bind", area.dir, join3(cwd, "content", area.name)]),
    "--bind",
    config.agentDir,
    config.agentDir,
    "--remount-ro",
    "/",
    "--chdir",
    cwd,
    "--",
    config.command,
    ...args
  ];
}
function expectedPiCommands(config, commands) {
  if (!Array.isArray(commands))
    return false;
  const base = [config.extension, config.web].filter((path) => path !== null);
  return commands.every((command) => command && typeof command === "object" && resourceCommand(config.resources, command.source, command.sourceInfo?.path ?? command.path, base));
}

// packages/integrations/src/steward/pi-model-gateway.ts
var failure = (code) => Object.assign(new Error(`Module model call: ${code}`), { code });
var tokens = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
var timedOut = (state) => state.expired;
var childOf = (state) => state.child;
var TOKEN_LIMIT_PI_VERSION = "1.5.0";
function tokenLimitExtension(input, dir) {
  return `import { writeFileSync } from "node:fs";
export default function (pi) {
  const limit = ${input.maxOutputTokens};
  const expectedModel = ${JSON.stringify(input.model)};
  let requested = false;
  // Pi catches hook exceptions and sends the original payload, so a thrown
  // error would fail open. Exit synchronously before handing a request back.
  const refuse = () => process.exit(1);
  pi.on("session_before_compact", refuse);
  pi.on("before_provider_request", (event, ctx) => {
    try {
      const model = ctx.model;
      if (!model || (model.provider + "/" + model.id !== expectedModel && model.id !== expectedModel) || requested) return refuse();
      const payload = event.payload;
      let target = payload, field;
      switch (model.api) {
        case "anthropic-messages": field = "max_tokens"; break;
        case "openai-completions":
          if (Object.hasOwn(payload, "max_tokens") === Object.hasOwn(payload, "max_completion_tokens")) return refuse();
          field = Object.hasOwn(payload, "max_tokens") ? "max_tokens" : "max_completion_tokens";
          break;
        case "openai-responses": field = "max_output_tokens"; break;
        case "google-generative-ai": target = payload.config; field = "maxOutputTokens"; break;
        // In particular, Pi's Codex request builder has no output-token cap.
        default: return refuse();
      }
      // Require Pi's provider to have emitted its supported native cap. Some
      // Responses compatibility modes deliberately omit it: do not invent one.
      if (!target || !Object.hasOwn(target, field) || !Number.isSafeInteger(target[field]) || target[field] <= 0) return refuse();
      target[field] = Math.min(target[field], limit);
      if (model.api === "openai-responses" && target[field] < 16) return refuse();
      if (model.api === "anthropic-messages" && payload.thinking?.type === "enabled") {
        // Match Pi's 1024-token answer reserve without increasing the cap.
        // Anthropic also needs at least 1024 thinking tokens when enabled.
        const budget = payload.thinking.budget_tokens;
        if (!Number.isSafeInteger(budget) || budget < 1024 || target[field] < 2048) return refuse();
        payload.thinking.budget_tokens = Math.min(budget, target[field] - 1024);
      }
      requested = true;
      // Pi redirects extension stdout to stderr in JSON mode. Record only the
      // applied limit in our private directory, before the provider can send.
      writeFileSync(${JSON.stringify(join4(dir, "token-limit.applied"))}, String(limit), { mode: 0o600, flag: "wx" });
      return payload;
    } catch { return refuse(); }
  });
}
`;
}
function validMessage(message, input) {
  const exact = message.provider ? `${message.provider}/${message.model}` : message.model;
  const output = tokens(message.usage?.output);
  return (exact === input.model || message.model === input.model) && (message.stopReason === "stop" || message.stopReason === "length") && Array.isArray(message.content) && !message.content.some((part) => part.type === "toolCall" || part.type === "text" && typeof part.text !== "string") && (output === null || output <= input.maxOutputTokens);
}
function messageResult(message) {
  const content = message.content ?? [];
  return { text: content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(""), inputTokens: tokens(message.usage?.input), outputTokens: tokens(message.usage?.output) };
}
function parseLine(text, input, output, fail) {
  if (!text.trim())
    return;
  try {
    const event = JSON.parse(text);
    if (event.type === "tool_execution_start" || event.type === "auto_retry_start" || event.type === "auto_compaction_start") {
      fail();
      return;
    }
    if (event.type !== "message_end" || event.message?.role !== "assistant")
      return;
    if (output.result || !validMessage(event.message, input)) {
      fail();
      return;
    }
    output.result = messageResult(event.message);
  } catch {
    fail();
  }
}
function runPiProcess(config, input, dir, state, isExpired) {
  const args = ["-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "-e", join4(dir, "token-limit.mjs"), "--mode", "json", "--model", input.model, ...input.thinking ? ["--thinking", input.thinking] : []];
  if (input.system !== undefined)
    args.push("--system-prompt", join4(dir, "system.txt"));
  return new Promise((resolve, reject) => {
    const process2 = spawn2(config.command, args, { cwd: dir, env: piEnvironment(config), stdio: ["pipe", "pipe", "ignore"], shell: false });
    state.child = process2;
    state.closed = new Promise((closed) => process2.once("close", () => closed()));
    let buffer = "", bytes = 0, invalid = false;
    const output = {};
    const fail = () => {
      invalid = true;
      process2.kill("SIGKILL");
    };
    process2.stdout.setEncoding("utf8");
    process2.stdout.on("data", (chunk) => {
      if (invalid)
        return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) {
        fail();
        return;
      }
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf(`
`)) !== -1) {
        parseLine(buffer.slice(0, end), input, output, fail);
        buffer = buffer.slice(end + 1);
      }
    });
    process2.stdin.on("error", fail);
    process2.once("error", fail);
    process2.once("close", (code) => {
      if (!invalid && buffer)
        parseLine(buffer, input, output, fail);
      if (isExpired())
        reject(failure("timeout"));
      else if (invalid || code !== 0 || !output.result)
        reject(failure("provider_error"));
      else
        resolve(output.result);
    });
    process2.stdin.end(input.prompt);
  });
}
async function work(config, input, state, isExpired) {
  if (config.version !== TOKEN_LIMIT_PI_VERSION || await inspectPiLaunch(config))
    throw failure("provider_error");
  if (isExpired())
    throw failure("timeout");
  state.dir = await mkdtemp(join4(tmpdir(), "chrona-model-"));
  await writeFile(join4(state.dir, "token-limit.mjs"), tokenLimitExtension(input, state.dir), { mode: 384 });
  if (input.system !== undefined)
    await writeFile(join4(state.dir, "system.txt"), input.system, { mode: 384 });
  if (isExpired())
    throw failure("timeout");
  const result = await runPiProcess(config, input, state.dir, state, isExpired);
  if (await readFile2(join4(state.dir, "token-limit.applied"), "utf8") !== String(input.maxOutputTokens))
    throw failure("provider_error");
  return result;
}
function timeoutError(error, isExpired) {
  return isExpired() || error && typeof error === "object" && "code" in error && error.code === "timeout";
}
async function cleanup(state, timer, workPromise) {
  if (timer)
    clearTimeout(timer);
  await workPromise?.catch(() => {});
  await state.closed;
  if (state.dir)
    await rm(state.dir, { recursive: true, force: true });
}
function createPiModelGateway(options) {
  const config = piLaunchConfig(options);
  return { async complete(input) {
    if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0 || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 2147483647)
      throw failure("provider_error");
    const state = { expired: false };
    let timer, workPromise;
    const isExpired = () => timedOut(state);
    try {
      return await Promise.race([
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            state.expired = true;
            childOf(state)?.kill("SIGKILL");
            reject(failure("timeout"));
          }, input.timeoutMs);
        }),
        workPromise = work(config, input, state, isExpired)
      ]);
    } catch (error) {
      throw timeoutError(error, isExpired) ? failure("timeout") : failure("provider_error");
    } finally {
      await cleanup(state, timer, workPromise);
    }
  } };
}

// packages/integrations/src/steward/pi-process.ts
import { spawn as spawn3 } from "child_process";
function launchPiProcess(input) {
  const child = spawn3(input.file, input.args, { cwd: input.cwd, env: input.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let failedToStart = false;
  const closed = new Promise((resolveClosed) => {
    child.once("error", () => {
      failedToStart = true;
    });
    child.once("close", (code, signal) => resolveClosed({ code: failedToStart ? null : code, signal }));
  });
  return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, closed, kill: (signal) => {
    child.kill(signal);
  } };
}

// packages/integrations/src/steward/pi-provider.ts
function buildProfile(config, input) {
  if (!input.model && input.resources !== "minimal")
    return null;
  const settingsPath = join5(config.agentDir, "settings.json");
  const raw = existsSync2(settingsPath) ? readFileSync2(settingsPath, "utf8").replace(/^\uFEFF/, "") : "";
  const settings = raw ? object2(JSON.parse(raw)) : {};
  const retry = object2(settings.retry);
  const profile = mkdtempSync(join5(config.agentDir, "build-"));
  for (const name of ["auth.json", "models.json"])
    if (existsSync2(join5(config.agentDir, name)))
      symlinkSync2(join5(config.agentDir, name), join5(profile, name));
  writeFileSync(join5(profile, "settings.json"), JSON.stringify({ ...settings, retry: {
    ...retry,
    enabled: true,
    maxRetries: 2,
    baseDelayMs: 2000,
    maxAgentDelayMs: 8000,
    provider: { ...object2(retry.provider), maxRetries: 0 }
  } }), { mode: 384 });
  return profile;
}
var object2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var imagesFor = (images) => images?.map((image) => ({ type: "image", data: image.base64, mimeType: image.mime }));
function bounded2(request, ms = 250) {
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => reject(new Error("Pi control request timed out")), ms);
    request.then((value) => {
      clearTimeout(timer);
      resolveRequest(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function rpcLines(receive, fail) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf(`
`)) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.trim())
        continue;
      if (line.length > 8 * 1024 * 1024) {
        fail("Pi RPC record too large");
        break;
      }
      try {
        receive(JSON.parse(line));
      } catch {
        fail("Malformed Pi RPC JSON");
        break;
      }
    }
    if (buffer.length > 8 * 1024 * 1024) {
      buffer = "";
      fail("Pi RPC record too large");
    }
  };
}
function messageError(message) {
  if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
    return typeof message.errorMessage === "string" ? message.errorMessage : "Pi model failed";
  }
  return null;
}

class PiDetail {
  input;
  secrets;
  seq = 0;
  queue = [];
  bytes = 0;
  draining = null;
  timer;
  lost = null;
  failure = false;
  final = null;
  messageId = 0;
  constructor(input, secrets) {
    this.input = input;
    this.secrets = secrets;
  }
  text(value, limit = 20000) {
    const text = providerText(value, this.secrets, limit, true);
    return Buffer.byteLength(text) > limit ? Buffer.from(text).subarray(0, limit).toString("utf8") : text;
  }
  event(payload) {
    return { ...this.input.execution, seq: ++this.seq, at: new Date().toISOString(), payload };
  }
  gap(seq) {
    this.lost = { from: Math.min(this.lost?.from ?? seq, seq), through: Math.max(this.lost?.through ?? seq, seq) };
    this.failure = true;
  }
  emit(payload) {
    if (!this.input.detail || !this.input.execution)
      return;
    const event = this.event(payload), bytes = executionJsonBytes(event);
    if (!executionEventSchema.safeParse(event).success || this.queue.length >= EXECUTION_EVENT_LIMITS.bufferEvents || this.bytes + bytes > EXECUTION_EVENT_LIMITS.bufferBytes) {
      this.gap(event.seq);
      return;
    }
    this.queue.push(event);
    this.bytes += bytes;
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.flush();
      }, EXECUTION_EVENT_LIMITS.flushMs);
  }
  receive(event) {
    this.receiveMessage(event);
    this.receiveTool(event);
  }
  receiveMessage(event) {
    const message = object2(event.message), delta = object2(event.assistantMessageEvent);
    if (event.type === "message_start" && ["user", "assistant"].includes(String(message.role))) {
      this.messageId++;
      this.emit({ type: "message", messageId: `message:${this.messageId}`, role: message.role, text: "", complete: false });
    }
    if (event.type === "message_update" && delta.type === "text_delta") {
      if (typeof delta.delta === "string" && Buffer.byteLength(delta.delta) > 20000)
        this.gap(++this.seq);
      this.emit({ type: "text_delta", messageId: `message:${this.messageId}`, delta: this.text(delta.delta) });
    }
    if (event.type === "message_end" && ["user", "assistant"].includes(String(message.role))) {
      const raw = this.messageText(message.content);
      const text = this.text(raw);
      if (Buffer.byteLength(raw) > 20000)
        this.gap(++this.seq);
      const payload = { type: "message", messageId: `message:${this.messageId}`, role: message.role, text, complete: true };
      if (message.role === "assistant")
        this.final = payload;
      this.emit(payload);
    }
  }
  messageText(content) {
    return Array.isArray(content) ? content.map(object2).filter((part) => part.type === "text").map((part) => typeof part.text === "string" ? part.text : "").join(`
`) : typeof content === "string" ? content : "";
  }
  toolId(value) {
    if (typeof value !== "string" || !value)
      return "";
    return this.text(value, 128) === value && /^[\w:.-]+$/.test(value) ? value : `tool:${createHash("sha256").update(value).digest("hex")}`;
  }
  receiveTool(event) {
    if (event.type === "tool_execution_start") {
      const tool = this.text(event.toolName, 100), toolCallId = this.toolId(event.toolCallId);
      if (tool && /^[\w:.-]+$/.test(toolCallId))
        this.emit({ type: "tool_started", toolCallId, tool, display: {} });
    }
    if (event.type === "tool_execution_end") {
      const tool = this.text(event.toolName, 100), toolCallId = this.toolId(event.toolCallId);
      if (tool && /^[\w:.-]+$/.test(toolCallId)) {
        const originalBytes = event.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(event.result));
        this.emit({ type: "tool_finished", toolCallId, tool, isError: event.isError === true, summary: event.isError ? "Tool failed" : "Tool completed", truncated: originalBytes > 0, originalBytes });
      }
    }
  }
  flush() {
    if (this.draining)
      return this.draining;
    this.draining = (async () => {
      while (this.queue.length) {
        const event = this.queue[0];
        try {
          await this.input.detail.append(event);
        } catch {
          this.gap(event.seq);
        }
        this.queue.shift();
        this.bytes -= executionJsonBytes(event);
      }
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }
  async close(status) {
    clearTimeout(this.timer);
    await this.flush();
    const append = async (payload) => {
      try {
        await this.input.detail.append(this.event(payload));
      } catch {
        this.failure = true;
      }
    };
    if (this.lost)
      await append({ type: "gap", ...this.lost, reason: "backpressure" });
    if (this.final)
      await append(this.final);
    await append({ type: "state", status, cancelRequested: false, stopConfirmed: true });
    if (this.failure)
      throw new Error("Execution detail is incomplete; recover the final snapshot");
  }
}

class PiRun {
  input;
  idleMs;
  child;
  events;
  detail;
  secrets = [];
  sessionId;
  resumeSessionId;
  sequence = 0;
  epoch = 0;
  streaming = false;
  sessionSettled = false;
  retrying = false;
  checking = false;
  startup = Promise.resolve();
  resourcesReady = Promise.resolve();
  cancellation = null;
  closing = null;
  settled = false;
  stderr = "";
  modelError = null;
  timer;
  poll;
  killTimer;
  idle;
  runningTools = 0;
  toolCalls = 0;
  complete;
  rejectDone;
  done = new Promise((resolveDone, rejectDone) => {
    this.complete = resolveDone;
    this.rejectDone = rejectDone;
  });
  pending = new Map;
  constructor(input, idleMs = 5 * 60000) {
    this.input = input;
    this.idleMs = idleMs;
    this.sessionId = input.sessionId;
    this.resumeSessionId = input.execution ? input.sessionId : null;
  }
  touch(event) {
    if (event?.type === "tool_execution_start") {
      this.runningTools++;
      this.toolCalls++;
      if (this.input.executionBudget && this.toolCalls > this.input.executionBudget.maxToolCalls)
        this.abortWith("failed", "Execution tool budget exceeded").catch(() => {});
    }
    if (event?.type === "tool_execution_end")
      this.runningTools = Math.max(0, this.runningTools - 1);
    clearTimeout(this.idle);
    if (this.inactive())
      return;
    this.idle = setTimeout(() => {
      if (this.runningTools > 0 || this.events?.waiting) {
        this.touch();
        return;
      }
      this.abortWith("timed_out", `Pi produced no output for ${Math.round(this.idleMs / 1000)}s`).catch(() => {});
    }, this.idleMs);
  }
  redact(text) {
    return providerText(stripVTControlCharacters(text), this.secrets, 1000);
  }
  inactive() {
    return this.closing !== null || this.settled || this.cancellation !== null;
  }
  runProfile = null;
  finalize() {
    if (this.settled)
      return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.poll);
    clearTimeout(this.killTimer);
    clearTimeout(this.idle);
    for (const request of this.pending.values())
      request.reject(new Error("Pi run ended"));
    this.pending.clear();
    if (this.runProfile) {
      rmSync(this.runProfile, { recursive: true, force: true });
      this.runProfile = null;
    }
    const result = this.closing ?? this.cancellation ?? { outcome: "failed", sessionId: this.sessionId, error: this.redact(`Pi exited before completion. ${this.stderr}`) };
    (async () => {
      await bounded2(this.events?.close() ?? Promise.resolve(), 1000).catch(() => {});
      try {
        await this.detail?.close(result.outcome === "finished" ? "completed" : "failed");
      } catch {
        this.complete({ ...result, outcome: "failed", error: "Execution detail is incomplete; recover the final snapshot" });
        return;
      }
      this.complete(result);
    })();
  }
  unconfirmedClosure(error) {
    if (this.settled)
      return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.poll);
    clearTimeout(this.killTimer);
    clearTimeout(this.idle);
    this.events?.interrupt();
    for (const request of this.pending.values())
      request.reject(new Error("Pi process closure is unconfirmed"));
    this.pending.clear();
    this.rejectDone(error);
  }
  stop(outcome, error) {
    if (this.closing || this.settled)
      return;
    outcome = this.cancellation?.outcome ?? outcome;
    error = this.cancellation?.error ?? error;
    this.closing = { outcome, sessionId: this.sessionId, error: error === null ? null : this.redact(`${error}${this.stderr ? `: ${this.stderr}` : ""}`) };
    this.events?.interrupt();
    clearTimeout(this.timer);
    clearTimeout(this.poll);
    clearTimeout(this.idle);
    if (!this.child) {
      this.finalize();
      return;
    }
    this.child.stdin.end();
    this.killTimer = setTimeout(() => this.child?.kill("SIGKILL"), 500);
  }
  send(type, fields = {}, cancelling = false) {
    if (this.closing || this.settled || this.cancellation && !cancelling || !this.child)
      return Promise.reject(new Error("Pi run is not active"));
    const id = String(++this.sequence);
    return new Promise((resolveRequest, reject) => {
      this.pending.set(id, { resolve: resolveRequest, reject });
      this.child.stdin.write(`${JSON.stringify({ id, type, ...fields })}
`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
          this.stop("failed", "Pi stdin failed");
        }
      });
    });
  }
  readyToCheck() {
    return this.sessionSettled && !this.retrying;
  }
  isComplete(version, state) {
    return version === this.epoch && this.readyToCheck() && !this.streaming && !this.events?.waiting && state.isStreaming === false && state.isCompacting !== true && state.pendingMessageCount === 0 && this.pending.size === 0;
  }
  async checkEnd() {
    if (this.inactive() || !this.readyToCheck() || this.checking)
      return;
    this.checking = true;
    const version = this.epoch;
    try {
      const state = await this.send("get_state");
      if (typeof state.sessionId === "string")
        this.sessionId = state.sessionId;
      await this.finishIfComplete(version, state);
    } catch {
      if (!this.inactive())
        this.stop("failed", "Could not inspect Pi completion state");
    } finally {
      this.checking = false;
      if (!this.inactive() && this.readyToCheck())
        this.pollEnd(25);
    }
  }
  async finishIfComplete(version, state) {
    if (this.inactive() || !this.isComplete(version, state))
      return;
    await this.collectUsage();
    if (!this.inactive() && this.isComplete(version, state))
      this.stop(this.modelError ? "failed" : "finished", this.modelError);
  }
  async collectUsage(cancelling = false) {
    if (this.events)
      await bounded2(this.events.collect(() => this.inspectStats(cancelling)), 750).catch(() => {});
  }
  pollEnd(delay) {
    clearTimeout(this.poll);
    this.poll = setTimeout(() => {
      this.checkEnd();
    }, delay);
  }
  async abortWith(outcome, error = outcome === "timed_out" ? "Pi deadline exceeded" : "Pi run aborted") {
    if (!this.inactive()) {
      this.cancellation = { outcome, error, sessionId: this.sessionId };
      this.sessionSettled = false;
      this.epoch++;
      this.events?.interrupt();
      await this.startup;
      if (this.child && !this.closing && !this.settled) {
        try {
          await bounded2(this.send("clear_queue", {}, true));
          await bounded2(this.send("abort", {}, true));
          await this.collectUsage(true);
        } catch {}
      }
      this.stop(outcome, error);
    }
    await this.done;
  }
  response(event) {
    const request = this.pending.get(String(event.id));
    if (!request)
      return;
    this.pending.delete(String(event.id));
    if (event.success === true)
      request.resolve(object2(event.data));
    else
      request.reject(new Error(this.redact(typeof event.error === "string" ? event.error : "Pi RPC command failed")));
  }
  agentEnd(event) {
    this.streaming = false;
    this.sessionSettled = false;
    this.epoch++;
    if (Array.isArray(event.messages)) {
      const last = event.messages.map(object2).filter((message) => message.role === "assistant").at(-1);
      if (last)
        this.modelError = messageError(last);
    }
  }
  messageEnd(value) {
    const message = object2(value);
    if (message.role === "assistant")
      this.modelError = messageError(message);
  }
  retryEnd(event) {
    this.retrying = false;
    if (event.success === false)
      this.modelError = typeof event.finalError === "string" && event.finalError ? event.finalError : this.modelError || "Pi model retry failed";
  }
  agentSettled(event) {
    this.sessionSettled = true;
    this.streaming = false;
    this.epoch++;
    if (event.aborted === true)
      this.modelError = "Pi run aborted";
    this.pollEnd(0);
  }
  async inspectStats(cancelling = false) {
    const id = String(this.sequence + 1);
    try {
      return await bounded2(this.send("get_session_stats", {}, cancelling), 250);
    } finally {
      this.pending.delete(id);
    }
  }
  writeUi(record) {
    if (this.inactive() || !this.child)
      return Promise.reject(new Error("Pi run is not active"));
    return new Promise((resolveWrite, reject) => this.child.stdin.write(`${JSON.stringify(record)}
`, (error) => error ? reject(error) : resolveWrite()));
  }
  receive(value) {
    const event = object2(value);
    this.touch(event);
    this.events?.receive(event);
    this.detail?.receive(event);
    switch (event.type) {
      case "response":
        this.response(event);
        break;
      case "agent_start":
        this.streaming = true;
        this.sessionSettled = false;
        this.modelError = null;
        this.epoch++;
        break;
      case "auto_retry_start":
        this.retrying = true;
        this.sessionSettled = false;
        this.epoch++;
        break;
      case "auto_retry_end":
        this.retryEnd(event);
        break;
      case "compaction_start":
      case "summarization_retry_scheduled":
        this.sessionSettled = false;
        this.epoch++;
        break;
      case "message_end":
        this.messageEnd(event.message);
        break;
      case "agent_end":
        this.agentEnd(event);
        break;
      case "agent_settled":
        this.agentSettled(event);
        break;
    }
  }
  listen(child, supervised) {
    child.stdin.on("error", () => this.stop("failed", "Pi stdin failed"));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-8000);
    });
    child.stdout.on("data", rpcLines((value) => this.receive(value), (message) => this.stop("failed", message)));
    child.closed.then(({ code, signal }) => {
      if (!supervised && code === null && signal === null)
        this.stop("unavailable", "Could not start Pi");
      this.finalize();
    }, (error) => this.unconfirmedClosure(error));
  }
  async loadResources(config) {
    const state = await this.send("get_state");
    if (this.resumeSessionId !== null && state.sessionId !== this.resumeSessionId)
      throw new Error("Pi resumed a different session than the requested execution context");
    if (this.input.model) {
      const model = object2(state.model);
      if (`${model.provider}/${model.id}` !== this.input.model)
        throw new Error("Pi selected a different model than the authorized build");
    }
    if (this.input.model || this.input.resources === "minimal") {
      await this.send("set_auto_retry", { enabled: true });
      await this.send("set_auto_compaction", { enabled: false });
    }
    if (typeof state.sessionId === "string")
      this.sessionId = state.sessionId;
    const resources = await this.send("get_commands");
    const selected = this.input.resources === "configured" ? config : { ...config, web: null, resources: { skills: [], extensions: [], tools: [] } };
    if (!expectedPiCommands(selected, resources.commands)) {
      this.stop("unavailable", "Unexpected Pi command resources; use a service-specific executable/profile");
      return;
    }
    await this.events?.resources(config.version, resources.commands, new Set([selected.extension, selected.web, ...selected.resources.extensions].filter(Boolean)).size);
    await this.events?.initialize(() => this.inspectStats());
  }
  async submitPrompt(fields) {
    const accepted = await this.send("prompt", fields);
    if (accepted.disposition === "handled" && !this.streaming) {
      this.sessionSettled = true;
      this.epoch++;
      this.pollEnd(0);
    }
  }
  async prompt(config) {
    this.resourcesReady = this.loadResources(config);
    try {
      await this.resourcesReady;
      await this.submitPrompt({ message: this.input.prompt, images: imagesFor(this.input.images) });
    } catch (error) {
      if (!this.inactive())
        this.stop("failed", error instanceof Error ? error.message : "Pi prompt failed");
    }
  }
  async prepare(config) {
    try {
      if (this.resumeSessionId !== null) {
        const error = await validatePiSessionResume({ sessionDir: this.input.sessionDir, sessionId: this.resumeSessionId, cwd: this.input.cwd });
        if (this.inactive())
          return;
        if (error) {
          this.stop("failed", error);
          return;
        }
      }
      const invalid = await inspectPiLaunch(config);
      if (this.inactive())
        return;
      if (invalid) {
        this.stop("unavailable", invalid);
        return;
      }
      if (profileOverlaps(config.agentDir, resolve3(this.input.cwd))) {
        this.stop("unavailable", "Pi profile must be separate from the working directory");
        return;
      }
      if (this.input.resources === "configured" || this.input.content?.length)
        prepareContent(this.input, !config.bwrap);
      this.runProfile = buildProfile(config, this.input);
      this.child = this.spawn(config);
      this.listen(this.child, !!config.options.launch);
      this.touch();
      this.prompt(config);
    } catch {
      if (!this.inactive())
        this.stop("unavailable", "Could not start Pi");
    }
  }
  spawn(config) {
    const browser = this.input.resources === "configured" && config.browserExtension ? config.options.browsers?.ensure() ?? null : null;
    return (config.options.launch ?? launchPiProcess)({
      file: config.bwrap ?? config.command,
      args: piArguments(config, this.input, this.input.systemPrompt, browser),
      cwd: resolve3(this.input.cwd),
      env: { ...piEnvironment(config), PI_CODING_AGENT_DIR: this.runProfile ?? config.agentDir, CHRONA_AGENT_URL: config.options.agentUrl, CHRONA_AGENT_TOKEN: this.input.token, ...this.input.executionBudget ? { CHRONA_EXECUTION_MAX_TOOL_CALLS: String(this.input.executionBudget.maxToolCalls) } : {}, ...browser ? { CHRONA_BROWSER: browser } : {} }
    });
  }
  start(config) {
    this.secrets = [this.input.token, ...Object.entries(piEnvironment(config)).flatMap(([key, value]) => key.endsWith("API_KEY") && value ? [value] : [])];
    const events = this.input.events;
    const input = events ? { ...this.input, events: { ...events, usage: async (value) => {
      this.detail?.emit({ type: "usage", input: value.input, output: value.output });
      await events.usage(value);
    } } } : this.input;
    this.events = new PiEvents(input, this.secrets, (record) => this.writeUi(record), (message) => {
      this.abortWith("failed", message).catch(() => {});
    });
    if (this.input.execution && this.input.detail) {
      this.detail = new PiDetail(this.input, this.secrets);
      this.detail.emit({ type: "state", status: "running", cancelRequested: false, stopConfirmed: false });
    }
    const remaining = this.input.deadline.getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      this.stop("timed_out", "Pi deadline exceeded");
      return;
    }
    this.timer = setTimeout(() => {
      this.abortWith("timed_out").catch(() => {});
    }, Math.min(remaining, 2147483647));
    this.startup = this.prepare(config);
  }
  async inject(message, images) {
    if (this.inactive())
      throw new Error("Pi run is not active");
    this.epoch++;
    this.sessionSettled = false;
    await this.startup;
    await this.resourcesReady;
    await this.submitPrompt({ message, images: imagesFor(images), streamingBehavior: "steer" });
  }
  async abort() {
    await this.abortWith("failed");
  }
}
function createPiProvider(options) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/steward-agent$/.test(options.agentUrl))
    throw new Error("Chrona agent URL must be loopback");
  const config = piLaunchConfig(options);
  return {
    name: "pi",
    transcript: piTranscript,
    supportsRunModel: true,
    async health() {
      const error = await inspectPiLaunch(config);
      return { available: error === null, sandboxed: error === null && config.bwrap !== null, error };
    },
    complete: createPiModelGateway(options).complete,
    start(input) {
      const run = new PiRun(input, options.idleTimeoutMs);
      run.start(config);
      return { done: run.done, inject: (message, images) => run.inject(message, images), abort: () => run.abort() };
    }
  };
}

// packages/integrations/src/steward/browser.ts
import { spawn as spawn4 } from "child_process";
import { createHash as createHash2 } from "crypto";
import { chmod, mkdir, rename, rm as rm2, writeFile as writeFile2 } from "fs/promises";
import { existsSync as existsSync3, realpathSync as realpathSync3 } from "fs";
import { join as join6 } from "path";
var NAMES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
var HEADLESS_SHELL = {
  version: "155.0.8059.39",
  sha256: "39dcb8c46550632a3d911850ab3b8af840b4e3f6d8622faa2018eb8756278786",
  url: "https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/linux64/chrome-headless-shell-linux64.zip"
};
function run(command, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn4(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const collect = (chunk) => {
      output = (output + chunk.toString("utf8")).slice(-4000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: null, output: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, output });
    });
  });
}
async function unzip(zip, target) {
  const unzipper = Bun.which("unzip"), python = Bun.which("python3");
  const result = unzipper ? await run(unzipper, ["-q", zip, "-d", target], 120000) : python ? await run(python, ["-I", "-m", "zipfile", "-e", zip, target], 120000) : { code: null, output: "Neither unzip nor python3 is installed" };
  if (result.code !== 0)
    throw new Error(`Unpacking the browser failed: ${result.output}`);
}
function createBrowsers(options) {
  const pinned = options.pinned ?? HEADLESS_SHELL, nixLink = join6(options.dir, "nix");
  const shell = join6(options.dir, pinned.version, "chrome-headless-shell-linux64", "chrome-headless-shell");
  let acquiring = null, failed = false;
  function find() {
    const candidates = [options.configured, ...NAMES.map((name) => Bun.which(name, options.path === undefined ? undefined : { PATH: options.path })), join6(nixLink, "bin", "chromium"), shell];
    for (const candidate of candidates)
      if (candidate && existsSync3(candidate))
        return realpathSync3(candidate);
    return null;
  }
  async function acquire() {
    if (options.nix) {
      const result = await run(options.nix, ["--extra-experimental-features", "nix-command flakes", "build", "--out-link", nixLink, `${options.nixpkgs ?? "nixpkgs"}#chromium`], 1200000);
      if (result.code !== 0)
        throw new Error(`nix build chromium failed: ${result.output}`);
      return;
    }
    if (process.platform !== "linux" || process.arch !== "x64")
      throw new Error(`No browser download for ${process.platform}-${process.arch}; install Chromium and set CHRONA_STEWARD_BROWSER`);
    const bytes = new Uint8Array(await (options.download ?? (async (url) => {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(600000) });
      if (!response.ok)
        throw new Error(`Browser download returned HTTP ${response.status}`);
      return response.arrayBuffer();
    }))(pinned.url));
    if (createHash2("sha256").update(bytes).digest("hex") !== pinned.sha256)
      throw new Error("Browser download does not match the pinned SHA-256");
    const staging = join6(options.dir, `${pinned.version}.partial`), zip = `${staging}.zip`;
    await rm2(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      await writeFile2(zip, bytes, { mode: 384 });
      await unzip(zip, staging);
      await chmod(join6(staging, "chrome-headless-shell-linux64", "chrome-headless-shell"), 493);
      await rename(staging, join6(options.dir, pinned.version));
    } finally {
      await rm2(zip, { force: true });
      await rm2(staging, { recursive: true, force: true });
    }
  }
  return {
    find,
    ensure() {
      const found = find();
      if (!found && !acquiring && !failed) {
        acquiring = mkdir(options.dir, { recursive: true }).then(acquire).catch((error) => {
          failed = true;
          options.onError?.(error instanceof Error ? error.message : String(error));
        }).finally(() => {
          acquiring = null;
        });
      }
      return found;
    },
    settled: () => acquiring ?? Promise.resolve()
  };
}

// packages/engine/src/modules/steward/builtin/agent/operations.ts
import { createHash as createHash3 } from "crypto";
import { mkdir as mkdir2, readFile as readFile3, writeFile as writeFile3, rename as rename2 } from "fs/promises";
import { join as join7 } from "path";
class AgentError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function createAgentOperations(provider, data, input) {
  const rows = new Map;
  const path = (id) => join7(data, "operations", createHash3("sha256").update(id).digest("hex") + ".json");
  async function owned(id) {
    const live = rows.get(id);
    if (live)
      return live;
    let saved;
    try {
      saved = object({ digest: string2().regex(/^[a-f0-9]{64}$/), outcome: runtimeOutcomeSchema.optional() }).strict().parse(JSON.parse(await readFile3(path(id), "utf8")));
    } catch (error) {
      if (error.code === "ENOENT")
        throw new AgentError("not_found", "Agent operation not found");
      throw error;
    }
    const row = { digest: saved.digest, ...saved.outcome ? { outcome: saved.outcome } : { failure: true } };
    rows.set(id, row);
    return row;
  }
  async function start(raw) {
    if (!provider)
      throw new AgentError("unavailable", "Agent backend unconfigured");
    const request = runtimeStartSchema.parse(raw), id = request.operationId;
    const digest = createHash3("sha256").update(JSON.stringify(request)).digest("hex");
    let previous;
    try {
      previous = await owned(id);
    } catch (error) {
      if (!(error instanceof AgentError) || error.code !== "not_found")
        throw error;
    }
    if (previous) {
      if (previous.digest !== digest)
        throw new AgentError("conflict", "Agent operation identity changed");
      if (previous.failure)
        throw new AgentError("unknown", "Agent launch requires reconciliation");
      return { operationId: id };
    }
    if (rows.size >= 64)
      throw new AgentError("capacity", "Agent operations full");
    await mkdir2(join7(data, "operations"), { recursive: true, mode: 448 });
    await writeFile3(path(id), JSON.stringify({ digest }), { flag: "wx", mode: 384 });
    const row = { digest };
    rows.set(id, row);
    try {
      row.handle = provider.start(input(request));
    } catch {
      row.failure = true;
      throw new AgentError("unknown", "Agent launch remains unconfirmed");
    }
    row.handle.done.then(async (outcome) => {
      const checked = runtimeOutcomeSchema.parse(outcome);
      await writeFile3(path(id) + ".pending", JSON.stringify({ digest, outcome: checked }), { mode: 384 });
      await rename2(path(id) + ".pending", path(id));
      row.outcome = checked;
    }).catch(() => {
      row.failure = true;
    });
    return { operationId: id };
  }
  async function control(name, args) {
    const row = await owned(args.operationId);
    if (name === "status")
      return { operationId: args.operationId, outcome: row.outcome ?? null, failure: row.failure ?? false };
    if (name === "release") {
      if (!row.outcome)
        throw new AgentError("conflict", "Agent completion remains unconfirmed");
      rows.delete(args.operationId);
      return { released: true };
    }
    if (!row.handle)
      throw new AgentError("unknown", "Agent control requires reconciliation");
    if (name === "abort") {
      row.handle.abort().catch(() => {
        row.failure = true;
      });
      return { requested: true };
    }
    if (name === "inject") {
      if (row.outcome || row.failure)
        throw new AgentError("conflict", "Agent operation ended");
      if (typeof args.message !== "string")
        throw new AgentError("invalid", "Message required");
      await row.handle.inject(args.message, args.images);
      return { accepted: true };
    }
    throw new AgentError("not_found", "Agent tool not found");
  }
  async function stop() {
    await Promise.all([...rows.values()].filter((row) => row.handle && !row.outcome).map(async (row) => {
      await row.handle.abort();
      await row.handle.done;
    }));
  }
  return { start, control, stop };
}

// packages/engine/src/modules/steward/builtin/agent/model-policy.ts
import { randomUUID as randomUUID2 } from "crypto";
import { mkdir as mkdir3, readFile as readFile4, rename as rename3, writeFile as writeFile4 } from "fs/promises";
import { join as join8 } from "path";

// packages/engine/src/modules/steward/builtin/agent/module-contracts.ts
var operation = object({ operationId: string2().regex(/^[a-f0-9]{64}$/) }).strict();
var moduleAgentInputs = {
  health: object({}).strict(),
  complete: object({ commandKey: executionIdSchema, prompt: string2().trim().min(1).max(200000), system: string2().max(20000).optional(), maxOutputTokens: number2().int().min(1).max(32000) }).strict(),
  completion: operation
};
var moduleAgentOutputs = {
  health: runtimeHealthSchema,
  complete: operation,
  completion: object({ result: runtimeCompletionSchema.nullable(), failure: boolean2(), unknown: boolean2().optional() }).strict()
};
function isModuleAgentTool(name) {
  return Object.hasOwn(moduleAgentInputs, name);
}
function camelArguments(value) {
  if (Array.isArray(value))
    return value.map(camelArguments);
  if (!value || typeof value !== "object")
    return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(result, normalized))
      throw new Error("invalid: Duplicate Agent argument");
    result[normalized] = camelArguments(child);
  }
  return result;
}
function moduleAgentInput(name, raw) {
  if (!isModuleAgentTool(name))
    throw new Error("forbidden: Agent tool is not available to modules");
  return moduleAgentInputs[name].parse(camelArguments(raw));
}

// packages/engine/src/modules/steward/builtin/agent/model-policy.ts
var modelPolicySchema = object({
  tiers: record(modelTier, object({ model: string2().trim().min(1).max(500), thinking: _enum(THINKING_LEVELS).optional() }).strict()),
  preferredTimeoutMs: number2().int().min(1).max(600000)
}).strict();
var SETTINGS_TIERS = ["fast", "balanced", "deep"];
var formTier = object({ model: string2().trim().max(500), thinking: _enum(["", ...THINKING_LEVELS]) }).strict();
var policyFormSchema = object({
  tiers: object({ fast: formTier, balanced: formTier, deep: formTier }).strict(),
  preferredTimeoutMs: string2().trim().regex(/^\d+$/)
}).strict();
var configureInput = object({ config: modelPolicySchema.optional(), clear: boolean2().optional(), form: policyFormSchema.optional(), view: boolean2().optional() }).strict().refine((value) => [value.config !== undefined, value.clear === true, value.form !== undefined].filter(Boolean).length <= 1, "Choose config, form or clear");
var configureOutput = object({ config: modelPolicySchema.nullable(), ready: boolean2(), form: policyFormSchema.optional() }).strict();
function policyForm(config) {
  return {
    tiers: Object.fromEntries(SETTINGS_TIERS.map((tier) => [tier, { model: config?.tiers[tier]?.model ?? "", thinking: config?.tiers[tier]?.thinking ?? "" }])),
    preferredTimeoutMs: String(config?.preferredTimeoutMs ?? 60000)
  };
}
var hardLimitsSchema = object({ maxCallsPerEvent: number2().int().positive(), maxOutputTokens: number2().int().positive().max(32000), eventTimeoutMs: number2().int().positive().max(600000) }).strict();
function createModelPolicy(data, authorize, backendReady) {
  const path = join8(data, "model-policy.json");
  let writes = Promise.resolve();
  async function read() {
    await writes;
    try {
      return modelPolicySchema.nullable().parse(JSON.parse(await readFile4(path, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT")
        return null;
      throw error;
    }
  }
  async function ready() {
    const config = await read();
    return !!config && Object.keys(config.tiers).length > 0 && await backendReady();
  }
  async function configure(raw, callId) {
    const normalized = camelArguments(raw);
    const originalConfig = raw?.config;
    if (originalConfig?.tiers && normalized.config)
      normalized.config.tiers = originalConfig.tiers;
    const args = configureInput.parse(normalized);
    object({ authorized: literal(true) }).parse(await authorize(callId));
    if (args.config !== undefined || args.clear || args.form) {
      const write = writes.then(async () => {
        let config = args.clear ? null : args.config;
        if (args.form) {
          let current = null;
          try {
            current = modelPolicySchema.nullable().parse(JSON.parse(await readFile4(path, "utf8")));
          } catch (error) {
            if (error.code !== "ENOENT")
              throw error;
          }
          const tiers = { ...current?.tiers };
          for (const tier of SETTINGS_TIERS) {
            const target = args.form.tiers[tier];
            if (target.model)
              tiers[tier] = { model: target.model, ...target.thinking ? { thinking: target.thinking } : {} };
            else
              delete tiers[tier];
          }
          config = modelPolicySchema.parse({ tiers, preferredTimeoutMs: Number(args.form.preferredTimeoutMs) });
        }
        await mkdir3(data, { recursive: true, mode: 448 });
        const temporary = path + "." + randomUUID2() + ".pending";
        await writeFile4(temporary, JSON.stringify(config), { mode: 384 });
        await rename3(temporary, path);
      });
      writes = write.catch(() => {});
      await write;
    }
    const config = await read();
    return { config, ready: await ready(), ...args.view || args.form ? { form: policyForm(config) } : {} };
  }
  async function select(declaredTier, hardLimits, maxOutputTokens) {
    const config = await read(), target = config?.tiers[declaredTier];
    if (!target || !await backendReady())
      throw new Error("unconfigured: Agent completion tier unavailable");
    return { ...target, maxOutputTokens: Math.min(maxOutputTokens, hardLimits.maxOutputTokens), timeoutMs: Math.min(config.preferredTimeoutMs, hardLimits.eventTimeoutMs) };
  }
  return { configure, ready, select };
}

// packages/engine/src/modules/steward/builtin/agent/contracts.ts
var directCompletionInput = object({ model: string2().min(1).max(500), thinking: _enum(THINKING_LEVELS).optional(), system: string2().max(200000).optional(), prompt: string2().max(2 * 1024 * 1024), maxOutputTokens: number2().int().positive().max(32000), timeoutMs: number2().int().positive().max(300000) }).strict();
var tierCompletionInput = directCompletionInput.omit({ model: true, thinking: true }).extend({ declaredTier: string2().min(1).max(40), effectiveHardLimits: hardLimitsSchema, timeoutMs: number2().int().positive().max(600000) }).strict();
var agentCompletionInput = union([directCompletionInput, tierCompletionInput]);
var agentTools = [
  ["health", object({}).strict(), runtimeHealthSchema],
  ["start", runtimeStartSchema, runtimeOperationSchema],
  ["status", runtimeOperationSchema, runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: boolean2() })],
  ["inject", runtimeOperationSchema.extend({ message: string2().max(2 * 1024 * 1024), images: runtimeStartSchema.shape.images }), object({ accepted: literal(true) }).strict()],
  ["abort", runtimeOperationSchema, object({ requested: literal(true) }).strict()],
  ["release", runtimeOperationSchema, object({ released: literal(true) }).strict()],
  ["complete", agentCompletionInput, runtimeOperationSchema],
  ["completion", runtimeOperationSchema, object({ result: runtimeCompletionSchema.nullable(), failure: boolean2() }).strict()],
  ["transcript", object({ sessionDir: string2().max(8192), limit: number2().int().min(1).max(300) }).strict(), runtimeTranscriptSchema]
];
function agentInput(name, raw) {
  const declaration = agentTools.find(([tool]) => tool === name);
  if (!declaration)
    throw new Error("Unknown Agent tool");
  return declaration[1].parse(raw);
}

// packages/engine/src/modules/steward/builtin/agent/module-operations.ts
import { createHash as createHash4 } from "crypto";
import { mkdir as mkdir4, readFile as readFile5, writeFile as writeFile5, rename as rename4 } from "fs/promises";
import { join as join9 } from "path";
var receipt = object({ owner: string2(), hash: string2(), digest: string2(), kind: literal("completion"), reservationId: string2().optional(), result: runtimeCompletionSchema.optional(), failure: boolean2().optional() }).strict();
function createModuleAgentOperations(data, call, complete, policy) {
  const hash = (value) => createHash4("sha256").update(JSON.stringify(value)).digest("hex");
  const file = (id) => join9(data, "module-operations", id + ".json");
  const active = new Map;
  const admit = (request) => call("runtime-callback.agent-admit", { callId: request.callId, operation: request.name });
  async function save(id, row) {
    await writeFile5(file(id) + ".pending", JSON.stringify(row), { mode: 384 });
    await rename4(file(id) + ".pending", file(id));
  }
  async function load(id, caller) {
    let row;
    try {
      row = receipt.parse(JSON.parse(await readFile5(file(id), "utf8")));
    } catch (error) {
      if (error.code === "ENOENT")
        return null;
      throw error;
    }
    if (row.owner !== caller.moduleId || row.hash !== caller.hash)
      throw new Error("forbidden: Agent operation belongs to another module or version");
    return row;
  }
  async function launchCompletion(request, id, row) {
    const reservation = object({ reservationId: string2(), declaredTier: string2(), effectiveHardLimits: hardLimitsSchema }).strict().parse(await admit(request));
    row.reservationId = reservation.reservationId;
    await save(id, row);
    const { args } = request;
    const work = (async () => {
      const target = await policy.select(reservation.declaredTier, reservation.effectiveHardLimits, Number(args.maxOutputTokens));
      row.result = runtimeCompletionSchema.parse(await complete({ prompt: args.prompt, system: args.system, ...target }));
    })().catch((error) => {
      if (error?.code !== "unknown" && !/^unknown:/.test(String(error?.message)))
        row.failure = true;
    }).then(async () => {
      await save(id, row);
      if (row.result || row.failure)
        await call("runtime-callback.agent-settle", { reservationId: reservation.reservationId, ...row.result ? { result: row.result } : {}, failed: !!row.failure });
    }).finally(() => active.delete(id));
    active.set(id, work);
    work.catch(() => {});
  }
  async function start(request) {
    const { args, caller, name } = request;
    const id = hash([caller.moduleId, name, args.commandKey]), digest = hash(args);
    const previous = await load(id, caller);
    if (previous) {
      if (previous.digest !== digest)
        throw new Error("conflict: Agent command key reused");
      if (!previous.result && !previous.failure && !active.has(id))
        throw new Error("unknown: Agent operation requires reconciliation");
      return { operationId: id };
    }
    if (active.size >= 64)
      throw new Error("capacity: Agent completions full");
    const row = { owner: caller.moduleId, hash: caller.hash, digest, kind: "completion" };
    await mkdir4(join9(data, "module-operations"), { recursive: true, mode: 448 });
    await writeFile5(file(id), JSON.stringify(row), { mode: 384, flag: "wx" });
    await launchCompletion(request, id, row);
    return { operationId: id };
  }
  async function completionStatus(request) {
    const id = String(request.args.operationId), row = await load(id, request.caller);
    if (!row)
      throw new Error("not_found: Agent operation not found");
    return { result: row.result ?? null, failure: !!row.failure, ...!row.result && !row.failure && !active.has(id) ? { unknown: true } : {} };
  }
  return { async handle(name, raw, caller, callId) {
    const args = moduleAgentInput(name, raw);
    const request = { name, args, caller, callId };
    return name === "complete" ? start(request) : completionStatus(request);
  } };
}

// packages/engine/src/modules/steward/builtin/agent/context-contracts.ts
var id7 = executionIdSchema;
var requestKey2 = string2().min(1).max(200);
var contextInput = object({ requestKey: requestKey2 }).strict();
var contextRunInput = object({ contextId: id7, requestKey: requestKey2, prompt: string2().trim().min(1).max(200000), content: array(string2().min(1).max(1000)).max(10).default([]), lane: _enum(["foreground", "background"]).default("background"), tools: array(string2().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)).max(100).default([]) }).strict();
var contextRunTarget = object({ runId: id7 }).strict();
var contextWriteInput = contextRunTarget.extend({ requestKey: requestKey2, text: string2().trim().min(1).max(20000) });
var contextInterruptInput = contextRunTarget.extend({ requestKey: requestKey2 });
var contextRespondInput = contextRunTarget.extend({ requestKey: requestKey2, questionId: id7, answer: string2().min(1).max(1e5) });
var contextStreamInput = contextRunTarget.extend({ after: number2().int().min(0).default(0), limit: number2().int().min(1).max(100).default(50) });
var contextOutput = object({ contextId: id7 }).strict();
var contextRunOutput = object({ runId: id7, contextId: id7, status: string2(), active: boolean2() }).strict();
var contextStreamOutput = object({ items: array(object({ sequence: number2().int(), at: string2(), kind: string2(), payload: unknown() }).strict()), after: number2().int(), ended: boolean2(), transcript: runtimeTranscriptSchema, interactions: array(providerInteractionSchema).max(12) }).strict();

// packages/logging/src/redaction.ts
var REDACTED = "[Redacted]";
var MAX_STRING_LENGTH = 400;
var SENSITIVE_QUERY_KEY = /^(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|token|password|secret|authorization|auth|key|signature|sig)$/i;
function truncateSafeText(value, maxLength = MAX_STRING_LENGTH) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\u2026(${value.length - maxLength} more chars)` : value;
}
function redactUrl(value) {
  return value.replace(/\bhttps?:\/\/[^\s"']+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      let changed = false;
      if (url.username || url.password) {
        url.username = "";
        url.password = "";
        changed = true;
      }
      for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEY.test(key)) {
          url.searchParams.set(key, REDACTED);
          changed = true;
        }
      }
      return changed ? url.toString() : candidate;
    } catch {
      return candidate;
    }
  });
}
function redactSensitiveText(value, maxLength = MAX_STRING_LENGTH) {
  const redacted = redactUrl(value).replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`).replace(/(?:\b|["'])(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?(?:secret|token|key)|token|password|passphrase|secret|authorization)(?:\b|["'])\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, (_match, separator) => `credential${separator}${REDACTED}`).replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, REDACTED);
  return truncateSafeText(redacted, maxLength);
}

// packages/integrations/src/steward/transcript-redaction.ts
var clip = (text, max) => text.length > max ? `${text.slice(0, max)}\u2026\uFF08\u5DF2\u622A\u65AD\uFF09` : text;
function transcriptRedactor() {
  const values = Object.entries(process.env).filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value && value.length >= 8).map(([, value]) => value);
  return (text, limit) => clip(redactSensitiveText(values.reduce((out, value) => out.replaceAll(value, "[redacted]"), text).replace(/\bxox[abp]-[A-Za-z0-9_-]{16,}/g, "[redacted]"), Number.MAX_SAFE_INTEGER), limit);
}

// packages/engine/src/modules/steward/builtin/agent/primitives.ts
var id8 = executionIdSchema;
var target2 = object({ executionId: id8, runId: id8, attemptId: id8 }).strict();
var primitiveInputs = {
  context: contextInput,
  run: union([contextRunInput, executionStartSchema.omit({ workId: true, commandKey: true, goal: true }).extend({ executionId: id8, requestKey: id8, prompt: executionStartSchema.shape.goal }), executionStartV2Schema.omit({ workId: true, commandKey: true, goal: true }).extend({ executionId: id8, requestKey: id8, prompt: executionStartSchema.shape.goal })]),
  get: union([contextRunTarget, object({ executionId: id8, runId: id8.optional(), attemptId: id8.optional() }).strict()]),
  lookup: object({ requestKey: id8 }).strict(),
  stream: union([contextStreamInput, target2.extend({ cursor: string2().max(1024).optional(), limit: number2().int().min(1).max(100).default(50) })]),
  write: union([contextWriteInput, target2.extend({ requestKey: id8, text: executionInputSchemas.send.shape.text })]),
  interrupt: union([contextInterruptInput, target2.extend({ requestKey: id8 })]),
  respond: union([contextRespondInput, target2.extend({ requestKey: id8, questionId: id8, answer: string2().min(1).max(1e5) })]),
  inspect: target2,
  placement: object({ executionId: id8 }).strict(),
  locations: object({ after: id8.optional(), limit: number2().int().min(1).max(100) }).strict(),
  cleanup: workCleanupInputSchema
};
var primitiveOutputs = {
  context: contextOutput,
  run: union([contextRunOutput, object({ execution: executionViewSchema, placement: executionPlacementViewSchema.optional() }).strict()]),
  get: union([contextRunOutput, executionViewSchema]),
  lookup: executionViewSchema,
  stream: union([contextStreamOutput, executionResponseDataSchemas.events]),
  write: object({ accepted: literal(true) }).strict(),
  interrupt: union([contextRunOutput, executionViewSchema]),
  respond: union([
    object({ accepted: literal(true) }).strict(),
    object({ accepted: literal(false), error: object({ code: _enum(["not_found", "conflict", "invalid", "forbidden", "capacity"]), message: string2() }).strict() }).strict()
  ]),
  inspect: object({ snapshot: executionResponseDataSchemas.snapshot, source: executionResultSourceSchema }).strict(),
  placement: executionPlacementViewSchema,
  locations: object({ locations: array(workLocationSchema).max(100), after: id8.nullable() }).strict(),
  cleanup: workCleanupReceiptSchema
};
function isAgentPrimitive(name) {
  return Object.hasOwn(primitiveInputs, name);
}
function primitiveInput(name, raw) {
  return primitiveInputs[name].parse(camelArguments(raw));
}
function createAgentPrimitives(call, control, transcript = async () => []) {
  return async (name, raw, callId) => {
    const args = primitiveInput(name, raw);
    const result = await call("runtime-callback.agent-admit", { callId, operation: name });
    if (name === "stream" && !("executionId" in args)) {
      const { transcript: descriptor, ...page } = object({ transcript: object({ sessionDir: string2(), limit: number2().int().min(1).max(100) }).strict() }).passthrough().parse(result);
      const redact = transcriptRedactor();
      const items = runtimeTranscriptSchema.parse(await transcript(descriptor)).slice(-descriptor.limit).map((item) => item.kind === "tool" ? { ...item, args: redact(item.args, 500) } : { ...item, text: redact(item.text, item.kind === "text" ? 4000 : 2000) });
      return contextStreamOutput.parse({ ...page, transcript: items });
    }
    if (name !== "write" && name !== "interrupt")
      return result;
    const isContext = !("executionId" in args);
    const admitted = isContext ? object({ perform: boolean2(), operationId: string2(), result: unknown() }).parse(result) : object({ perform: boolean2(), operationId: string2(), execution: executionViewSchema }).parse(result);
    if (admitted.perform)
      await control(name === "write" ? "inject" : "abort", { operationId: admitted.operationId, ...name === "write" ? { message: args.text } : {} });
    if (isContext)
      await call("runtime-callback.agent-admit", { callId, operation: name, settle: true });
    if (name === "write")
      return { accepted: true };
    return "execution" in admitted ? admitted.execution : admitted.result;
  };
}

// packages/engine/src/modules/steward/builtin/agent/settings-page.ts
var state = (path) => ({ $state: path });
var bind = (path) => ({ $bindState: path });
var node = (type, props, children = []) => ({ type, props, children });
var status = (value) => ({ action: "setState", params: { statePath: "/saveStatus", value } });
var labels = { fast: "\u5FEB\u901F", balanced: "\u5747\u8861", deep: "\u6DF1\u5EA6" };
var thinkingLabels = { off: "\u5173\u95ED", minimal: "\u6700\u5C11", low: "\u8F83\u5C11", medium: "\u4E2D\u7B49", high: "\u8F83\u591A", xhigh: "\u66F4\u591A", max: "\u6700\u591A" };
var save = [status("saving"), {
  action: "call",
  params: { tool: "configure", args: { form: { tiers: state("/policy/form/tiers"), "preferred-timeout-ms": state("/policy/form/preferredTimeoutMs") }, view: true }, result: "/policy", reload: false },
  onSuccess: status("saved"),
  onError: status("failed")
}];
var SETTINGS_PAGE = {
  id: "settings",
  title: "Agent \u8BBE\u7F6E",
  layout: "document",
  purpose: "settings",
  data: { policy: { tool: "configure", args: { view: true } } },
  spec: {
    root: "settings",
    state: { saveStatus: "" },
    elements: {
      settings: node("Stack", { gap: "lg" }, ["help", "form", "saved", "failed"]),
      help: node("Text", { text: "\u4E3A\u5FEB\u901F\u3001\u5747\u8861\u3001\u6DF1\u5EA6\u4EFB\u52A1\u9009\u62E9\u6A21\u578B\u3002\u6A21\u578B\u586B\u5199\u4E3A\u63D0\u4F9B\u65B9/\u6A21\u578B\u540D\u79F0\uFF1B\u7559\u7A7A\u8868\u793A\u505C\u7528\u8BE5\u6863\u3002\u5DF2\u6709\u81EA\u5B9A\u4E49\u6863\u4F4D\u4F1A\u4FDD\u7559\u3002" }),
      form: { ...node("Stack", { gap: "md" }, [...SETTINGS_TIERS, "timeout", "limits", "save"]), visible: state("/policy/form") },
      ...Object.fromEntries(SETTINGS_TIERS.flatMap((tier) => [
        [tier, node("Card", { title: `${labels[tier]}\uFF08${tier}\uFF09` }, [`${tier}Model`, `${tier}Thinking`])],
        [`${tier}Model`, node("Input", { label: `${labels[tier]}\u6A21\u578B`, name: `${tier}-model`, placeholder: "\u63D0\u4F9B\u65B9/\u6A21\u578B\u540D\u79F0", value: bind(`/policy/form/tiers/${tier}/model`) })],
        [`${tier}Thinking`, node("Select", { label: `${labels[tier]}\u601D\u8003\u5F3A\u5EA6`, name: `${tier}-thinking`, value: bind(`/policy/form/tiers/${tier}/thinking`), options: [{ value: "", label: "\u6A21\u578B\u9ED8\u8BA4" }, ...THINKING_LEVELS.map((value) => ({ value, label: thinkingLabels[value] }))] })]
      ])),
      timeout: node("Input", { label: "\u9996\u9009\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF0C1\u2013600000\uFF09", name: "preferred-timeout-ms", type: "number", value: bind("/policy/form/preferredTimeoutMs") }),
      limits: node("Text", { text: "\u6267\u884C\u4ECD\u53D7\u5185\u6838\u9884\u7B97\u548C\u8D85\u65F6\u4E0A\u9650\u7EA6\u675F\u3002\u4FDD\u5B58\u4E0D\u4F1A\u542F\u52A8\u6A21\u578B\u3002", variant: "muted" }),
      save: { ...node("Button", { label: "\u4FDD\u5B58 Agent \u8BBE\u7F6E", disabled: { $cond: { $state: "/saveStatus", eq: "saving" }, $then: true, $else: false } }), on: { press: save } },
      saved: { ...node("Alert", { title: "Agent \u8BBE\u7F6E\u5DF2\u4FDD\u5B58", type: "success" }), visible: { $state: "/saveStatus", eq: "saved" } },
      failed: { ...node("Alert", { title: "\u4FDD\u5B58\u5931\u8D25", message: "\u8BF7\u68C0\u67E5\u6A21\u578B\u540D\u79F0\u3001\u601D\u8003\u5F3A\u5EA6\u548C\u6574\u6570\u8D85\u65F6\uFF0C\u5E76\u786E\u8BA4\u5F53\u524D\u5E94\u7528\u4ECD\u6709\u6240\u6709\u8005\u6743\u9650\u540E\u91CD\u8BD5\u3002", type: "error" }), visible: { $state: "/saveStatus", eq: "failed" } }
    }
  }
};
function settingsRegistration(call) {
  let active = false, registered = false, pending = false;
  async function refresh() {
    if (!active || registered || pending)
      return;
    pending = true;
    try {
      const result = await call("web.page-set", SETTINGS_PAGE);
      if (result && typeof result === "object" && "error" in result)
        throw new Error("Page registration rejected");
      registered = true;
    } catch {
      console.error("Agent \u8BBE\u7F6E\u9875\u9762\u767B\u8BB0\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5");
    } finally {
      pending = false;
    }
  }
  return { async activate() {
    active = true;
    registered = false;
    await refresh();
  }, refresh };
}

// packages/engine/src/modules/steward/builtin/agent/project-contracts.ts
var projectsInput = object({
  action: _enum(["list", "register", "create"]),
  path: string2().min(1).max(8192).optional(),
  name: string2().min(1).max(64).optional()
}).strict().superRefine((input, ctx) => {
  const valid = input.action === "list" ? input.path === undefined && input.name === undefined : input.action === "register" ? input.path !== undefined && input.name === undefined : input.name !== undefined && input.path === undefined;
  if (!valid)
    ctx.addIssue({ code: "custom", message: "list takes no path/name; register requires only path; create requires only name" });
});
var identity = string2().min(1).max(256);
var projectPrincipal = object({
  workspaceId: identity,
  ownerId: literal("owner"),
  caller: object({ kind: literal("module"), moduleId: identity, hash: identity }).strict()
}).strict();
var projectView = object({ projectRef: identity, path: string2().min(1).max(8192), label: string2().min(1).max(8192) }).strict();
var projectsOutput = discriminatedUnion("action", [
  object({ action: literal("list"), principal: projectPrincipal, projects: array(projectView).max(100) }).strict(),
  object({ action: literal("register"), principal: projectPrincipal, project: projectView }).strict(),
  object({ action: literal("create"), principal: projectPrincipal, project: projectView }).strict()
]);

// packages/engine/src/modules/steward/builtin/agent/runtime.ts
var configuration = process.env.CHRONA_AGENT_CONFIGURATION ? JSON.parse(process.env.CHRONA_AGENT_CONFIGURATION) : undefined;
var modelEnvironment = JSON.parse(process.env.CHRONA_AGENT_MODEL_ENV ?? "{}");
for (const key of PI_MODEL_ENVIRONMENT_KEYS)
  if (typeof modelEnvironment[key] === "string")
    process.env[key] = modelEnvironment[key];
delete process.env.CHRONA_AGENT_MODEL_ENV;
var provider2 = configuration?.backend === "pi" ? createPiProvider({ ...configuration.pi, browsers: createBrowsers(configuration.browser) }) : undefined;
async function event(callbackId, value) {
  return chrona.call("runtime-callback.event", { callbackId, event: value });
}
function input(raw) {
  const { operationId: _id, callbacks, deadline, ...request } = runtimeStartSchema.parse(raw);
  return { ...request, deadline: new Date(deadline), ...callbacks ? {
    events: {
      async progress(value) {
        await event(callbacks, { kind: "progress", value });
      },
      async usage(value) {
        await event(callbacks, { kind: "usage", value });
      },
      async resources(value) {
        await event(callbacks, { kind: "resources", value });
      },
      async question(value, signal) {
        const requestId = randomUUID3();
        const abort = () => {
          event(callbacks, { kind: "interrupt", requestId }).catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const answer = event(callbacks, { kind: "question", requestId, value });
          if (signal.aborted)
            abort();
          return providerAnswerSchema.parse(await answer);
        } finally {
          signal.removeEventListener("abort", abort);
        }
      }
    },
    detail: { async append(value) {
      await event(callbacks, { kind: "detail", value });
    } }
  } : {} };
}
var operations = createAgentOperations(provider2, chrona.paths.data, input);
var policy = createModelPolicy(chrona.paths.data, (callId) => chrona.call("runtime-callback.agent-admit", { callId, operation: "configure" }), async () => !!provider2?.complete && !!(await provider2.health()).available);
var settingsPage = settingsRegistration((target, args) => chrona.call(target, args));
on("activated", async () => {
  await settingsPage.activate();
  return {};
});
setInterval(() => void settingsPage.refresh(), 60000).unref();
var completions = new Map;
function complete(args) {
  if (!provider2?.complete)
    throw new AgentError("unavailable", "Completion unconfigured");
  if (completions.size >= 64)
    throw new AgentError("capacity", "Agent completions full");
  const operationId = randomUUID3(), row = { result: null, failure: false };
  completions.set(operationId, row);
  const timeout = setTimeout(() => completions.delete(operationId), 360000);
  provider2.complete(args).then((result) => {
    row.result = runtimeCompletionSchema.parse(result);
  }).catch((error) => {
    if (error?.code !== "unknown")
      row.failure = true;
  }).finally(() => timeout.unref());
  return { operationId };
}
function completion(operationId) {
  const row = completions.get(operationId);
  if (!row)
    throw new AgentError("not_found", "Completion not found");
  if (row.result || row.failure)
    completions.delete(operationId);
  return row;
}
var moduleOperations = createModuleAgentOperations(chrona.paths.data, (target, args) => chrona.call(target, args), async (args) => {
  if (!provider2?.complete)
    throw new AgentError("unavailable", "Completion unconfigured");
  return provider2.complete(args);
}, policy);
var primitive = createAgentPrimitives((target, args) => chrona.call(target, args), (name, args) => operations.control(name, args), async (input) => await provider2?.transcript?.(input) ?? []);
async function health() {
  return { name: provider2?.name ?? "unconfigured", supportsRunModel: provider2?.supportsRunModel ?? false, complete: await policy.ready(), ...await (provider2?.health() ?? { available: false, sandboxed: false, error: null }) };
}
async function kernelTool(name, raw) {
  const args = agentInput(name, JSON.parse(String(raw)));
  if (name === "health")
    return health();
  if (name === "start")
    return operations.start(args);
  if (["status", "abort", "inject", "release"].includes(name))
    return operations.control(name, args);
  if (!provider2)
    throw new AgentError("unavailable", "Agent backend unconfigured");
  if (name === "complete") {
    if (typeof args.declaredTier === "string") {
      const target = await policy.select(args.declaredTier, args.effectiveHardLimits, Number(args.maxOutputTokens));
      return complete({ prompt: args.prompt, system: args.system, ...target });
    }
    return complete(args);
  }
  if (name === "completion")
    return completion(String(args.operationId));
  if (name === "transcript")
    return await provider2.transcript?.(args) ?? [];
  throw new AgentError("not_found", "Agent tool not found");
}
function toolError(error) {
  if (error instanceof AgentError)
    return new ModelError(error.code, error.message);
  if (error instanceof ModelError)
    return error;
  if (error instanceof ZodError)
    return new ModelError("invalid", "Invalid Agent arguments");
  if (error instanceof Error) {
    const code = /^(forbidden|conflict|not_found|invalid|unknown|capacity|unconfigured|unavailable):/.exec(error.message)?.[1];
    if (code)
      return new ModelError(code, error.message);
  }
  return new ModelError("unknown", "Agent operation remains unconfirmed");
}
async function configure(call, caller, args) {
  const callId = call?.id;
  if (!callId || !caller || !["owner", "module"].includes(caller.kind))
    throw new ModelError("forbidden", "Agent configuration requires an admitted owner caller");
  try {
    return { result: await policy.configure(args, callId) };
  } catch (error) {
    if (error instanceof ZodError)
      throw new ModelError("invalid", "Agent \u8BBE\u7F6E\u65E0\u6548\uFF1A\u8BF7\u68C0\u67E5\u6A21\u578B\u3001\u601D\u8003\u5F3A\u5EA6\u53CA 1\u2013600000 \u6BEB\u79D2\u7684\u6574\u6570\u8D85\u65F6");
    throw error;
  }
}
async function projects(call, caller, args) {
  if (caller?.kind !== "module" || !call?.id)
    throw new ModelError("forbidden", "Agent projects requires an admitted module caller");
  projectsInput.parse(args);
  return { result: projectsOutput.parse(await chrona.call("runtime-callback.agent-admit", { callId: call.id, operation: "projects" })) };
}
async function moduleTool(id, args, caller, callId) {
  if (id === "health") {
    agentInput("health", args);
    return { result: await health() };
  }
  if (isAgentPrimitive(id))
    return { result: await primitive(id, args, callId) };
  if (!isModuleAgentTool(id))
    throw new ModelError("forbidden", "Agent tool is not available to modules");
  return { result: await moduleOperations.handle(id, args, caller, callId) };
}
on("tool", async (trigger) => {
  const caller = trigger.caller;
  try {
    if (trigger.id === "projects")
      return await projects(trigger.call, caller, trigger.args);
    if (caller?.kind === "kernel")
      return { result: await kernelTool(trigger.id, trigger.args.input) };
    if (trigger.id === "configure")
      return await configure(trigger.call, caller, trigger.args);
    if (caller?.kind !== "module" || !trigger.call?.id)
      throw new ModelError("forbidden", "Agent tools require an admitted caller");
    return await moduleTool(trigger.id, trigger.args, caller, trigger.call.id);
  } catch (error) {
    throw toolError(error);
  }
});
var stop = () => {
  operations.stop().finally(() => process.exit(0));
};
onDisconnect(stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
