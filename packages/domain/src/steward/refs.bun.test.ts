import { expect, test } from "bun:test";
import { generateRef, isRef, findRefs } from "./refs";
test.each([[0, "2222"], [0.999999, "ZZZZ"]] as const)("generate %s", (random, ref) => { expect(generateRef(() => random)).toBe(ref); });
test.each([-1, 1, NaN, Infinity])("reject random %s", (value) => { expect(() => generateRef(() => value)).toThrow(); });
test.each([["AB23", true], ["ab23", true], ["AB01", false], ["AILO", false], ["AB234", false], [" AB23", false]] as const)("validate %s", (ref, valid) => { expect(isRef(ref)).toBe(valid); });
test.each([
  ["同意：ab23，CD45", ["AB23", "CD45"]], ["AB23 ab23", ["AB23"]],
  ["xAB23 AB234 _AB23 AB23_ 中文AB23", []], ["(ab23)", ["AB23"]], ["", []],
] as const)("extract %s", (text, refs) => { expect(findRefs(text)).toEqual([...refs]); });
