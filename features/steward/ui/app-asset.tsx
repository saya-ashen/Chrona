import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { fileKind } from "../model/app-file";
import { saveAppBlob } from "../model/app-asset";
import { useAppAsset } from "../hooks/use-app-asset";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { MutationStatus, ResourceStatus } from "./resource-status";
type Props = { client: StewardClient; appId: string; path: string; revision?: string };

export function AppDownload({ client, appId, path, label }: Props & { label?: string }) {
  const c = useI18n().messages.steward.appFile;
  const mutation = useStewardMutation(() => {});
  return <div className="inline-grid gap-1"><Button variant="link" className="h-auto justify-start whitespace-normal p-0 text-left" disabled={mutation.pending} onClick={() => void mutation.run(async () => saveAppBlob(await client.raw(appId, path), path))}>{label ?? `${c.download}: ${path}`}</Button><MutationStatus mutation={mutation} /></div>;
}
/** Also used inside Markdown paragraphs; keep the wrapper valid phrasing content. */
export function AppImage({ client, appId, path, revision, alt = path }: Props & { alt?: string }) {
  const { messages } = useI18n(), asset = useAppAsset(client, appId, path, revision);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="inline-grid min-w-0 gap-1">
    {asset.loading && !asset.url && <span role="status">{messages.steward.foundation.loading}</span>}
    {asset.error && <span role="alert">{messages.steward.foundation[asset.error.messageKey]} <Button variant="link" onClick={asset.refresh}>{messages.steward.foundation.retry}</Button></span>}
    {asset.url && (failed === asset.url ? <span role="alert">{messages.steward.appFile.previewUnavailable}</span> : <img src={asset.url} alt={alt} className="max-h-[70vh] max-w-full object-contain" onError={() => setFailed(asset.url)} />)}
  </span>;
}
export function AppAsset(props: Props) {
  const kind = fileKind(props.path);
  if (kind === "image") return <div className="grid min-w-0 gap-3"><AppImage {...props} /><AppDownload {...props} /></div>;
  if (kind === "audio" || kind === "video") return <AppMedia {...props} kind={kind} />;
  return <AppDownload {...props} />;
}
function AppMedia({ kind, ...props }: Props & { kind: "audio" | "video" }) {
  const asset = useAppAsset(props.client, props.appId, props.path, props.revision), c = useI18n().messages.steward.appFile;
  const [failed, setFailed] = useState<string | null>(null);
  const player = { src: asset.url ?? undefined, controls: true, preload: "metadata", "aria-label": props.path, className: "max-w-full", onError: () => setFailed(asset.url) };
  return <div className="grid min-w-0 gap-3"><ResourceStatus resource={asset} />
    {asset.url && (failed === asset.url ? <p role="alert">{c.previewUnavailable}</p> : kind === "audio" ? <audio {...player} /> : <video {...player} />)}
    <AppDownload {...props} />
  </div>;
}
