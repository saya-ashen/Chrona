// Compact human-readable references; not part of the v3 wire contract.
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const REF_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export function generateRef(random: () => number): string {
  return Array.from({ length: 4 }, () => {
    const value = random();
    if (!(value >= 0 && value < 1)) throw new RangeError("random must return a value in [0, 1)");
    return REF_ALPHABET[Math.floor(value * REF_ALPHABET.length)];
  }).join("");
}
export function isRef(s: string): boolean { return REF_PATTERN.test(s.toUpperCase()); }
export function findRefs(text: string): string[] {
  return [...new Set((text.match(/[\p{L}\p{N}_]+/gu) ?? []).filter(isRef).map((s) => s.toUpperCase()))];
}
