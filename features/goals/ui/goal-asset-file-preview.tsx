"use client";

import { useState } from "react";
import { FileViewer } from "@open-file-viewer/react";
import { imagePlugin, officePlugin, pdfPlugin, textPlugin } from "@open-file-viewer/core";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import "@open-file-viewer/core/style.css";

const plugins = [
  imagePlugin(),
  textPlugin(),
  pdfPlugin({ workerSrc: pdfWorkerSrc }),
  officePlugin(),
];

export type GoalAssetFilePreviewProps = {
  source: string;
  filename: string;
  mimeType?: string | null;
  locale: "zh-CN" | "en-US";
  description: string;
};

export default function GoalAssetFilePreview({ source, filename, mimeType, locale, description }: GoalAssetFilePreviewProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      aria-label={filename}
      data-asset-canvas="file"
      data-asset-canvas-mode="read"
      className="min-h-[32rem] overflow-hidden rounded-xl border bg-background shadow-xs"
    >
      {error ? <p role="alert" className="border-b bg-destructive/5 px-4 py-3 text-sm text-destructive">{description}</p> : null}
      <FileViewer
        file={source}
        fileName={filename}
        mimeType={mimeType ?? undefined}
        locale={locale}
        width="100%"
        height="min(72vh, 52rem)"
        fit="contain"
        fallback="download"
        toolbar={{ download: true, fullscreen: true, print: true, search: true }}
        theme="auto"
        plugins={plugins}
        onLoad={() => setError(null)}
        onError={(cause) => setError(cause.message)}
        onUnsupported={() => setError("unsupported")}
      />
    </section>
  );
}
