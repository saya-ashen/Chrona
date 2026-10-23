const types: Partial<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", opus: "audio/ogg", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg" };
/** No HTML/SVG/PDF embedding. Preview types are a small browser-media allowlist. */
export function appAssetType(path: string): string | null { return types[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? null; }
export async function saveAppBlob(blob: Blob, path: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = path.split("/").at(-1) || "download"; link.hidden = true;
  try {
    document.body.appendChild(link); link.click();
    // Let the browser consume the click before revoking; never expose the owner key in an href.
    await new Promise(resolve => setTimeout(resolve, 1000));
  } finally { link.remove(); URL.revokeObjectURL(url); }
}
