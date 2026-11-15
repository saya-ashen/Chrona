import type { DocumentArtifact } from './core-actions';
import { redactSensitiveText } from './core-redaction';

/** The kernel retains at most 16,000 characters per string and 32,000 bytes per result. */
const fitsToolResult = (value: unknown) => {
  const json = JSON.stringify(value);
  return json.length <= 16000 && Buffer.byteLength(JSON.stringify({ json })) <= 32000;
};
const retainedText = (value: unknown) => {
  const json = JSON.stringify(value);
  return redactSensitiveText(json, Number.MAX_SAFE_INTEGER) === json;
};
const splitsCharacter = (body: string, at: number) =>
  /[\uD800-\uDBFF]/u.test(body[at - 1] ?? '') && /[\uDC00-\uDFFF]/u.test(body[at] ?? '');
export type ArtifactManifest = Omit<DocumentArtifact, 'body'> & {
  kind: 'artifact-manifest'; bodyLength: number; offsetUnit: 'utf16'; chunkSize: number;
};
export type ArtifactChunk = {
  kind: 'artifact-chunk'; ref: string; digest: string; bodyLength: number;
  offset: number; nextOffset: number | null; body: string;
};
const chunkAt = (document: DocumentArtifact, offset: number, end: number): ArtifactChunk => ({
  kind: 'artifact-chunk', ref: document.ref, digest: document.digest, bodyLength: document.body.length,
  offset, nextOffset: end === document.body.length ? null : end, body: document.body.slice(offset, end),
});
function chunkResult(document: DocumentArtifact, offset: number): ArtifactChunk {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= document.body.length || splitsCharacter(document.body, offset))
    throw Error('Artifact offset must address a complete character within the persisted body');
  // Maximize each read within BOTH retained-output bounds, including JSON control escaping.
  let low = offset, high = Math.min(offset + 16000, document.body.length);
  while (low < high) {
    const end = Math.ceil((low + high) / 2);
    if (fitsToolResult(chunkAt(document, offset, end))) low = end; else high = end - 1;
  }
  for (let end = low; end > offset; end--) {
    if (splitsCharacter(document.body, end)) continue;
    const chunk = chunkAt(document, offset, end);
    // A cut may create a credential-pattern word boundary absent in the whole document. Keep
    // this chunk AND the remaining suffix unchanged by the same text redactor used by the kernel.
    if (retainedText(chunk) && retainedText(document.body.slice(end))) return chunk;
  }
  throw Error('Artifact chunk cannot be retained completely at this offset');
}

/** Apply only AFTER the owning adapter's authorized persisted read/create. No caller-supplied material. */
export function artifactToolResult(document: DocumentArtifact, offset?: number): DocumentArtifact | ArtifactManifest | ArtifactChunk {
  if (offset !== undefined) return chunkResult(document, offset);
  if (fitsToolResult(document)) return document;
  const { body, ...metadata } = document;
  const manifest: ArtifactManifest = { ...metadata, kind: 'artifact-manifest', bodyLength: body.length, offsetUnit: 'utf16', chunkSize: 16000 };
  if (!fitsToolResult(manifest)) throw Error('Artifact metadata exceeds the retained tool-result bound');
  return manifest;
}
