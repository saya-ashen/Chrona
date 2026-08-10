"use client";

import { useState } from "react";
import {
  Check,
  ChevronUp,
  Clipboard,
  Download,
  ExternalLink,
  SquareArrowOutUpRight,
} from "lucide-react";
import {
  Badge,
  Button,
  MarkdownContent,
} from "@shared/ui";


import type {
  GoalArtifactData,
  GoalCopy,
  GoalData,
} from "../model/goal-types";
import { LocalizedLink } from "./localized-link";
export function format(copy: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    copy,
  );
}

export function formatDate(value: string | null, locale: "en" | "zh") {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function artifactTypeLabel(type: string) {
  return type.replaceAll("_", " ");
}

type ArtifactActionProps = {
  artifact: GoalArtifactData;
  copy: GoalCopy;
  goalId: string;
  goalAssetId?: string;
  preview: string;
  previewOpen: boolean;
  copied: boolean;
  showPreview: boolean;
  copyLabel?: string;
  onPreviewToggle: () => void;
  onCopy: () => void;
};

export function ArtifactActions({ artifact, goalId, goalAssetId, copy, showPreview = true, copyLabel }: Omit<ArtifactActionProps, "preview" | "previewOpen" | "copied" | "onPreviewToggle" | "onCopy">) {
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = artifact.contentPreview?.trim() ?? "";
  const onCopy = () => {
    void navigator.clipboard?.writeText(preview || artifact.uri).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return <div className="space-y-3" data-artifact-id={artifact.id}>
    {showPreview ? <ArtifactPreview artifact={artifact} preview={preview} previewOpen={previewOpen} /> : null}
    <ArtifactActionControls artifact={artifact} copy={copy} goalId={goalId} goalAssetId={goalAssetId} preview={preview} previewOpen={previewOpen} copied={copied} showPreview={showPreview} copyLabel={copyLabel} onPreviewToggle={() => setPreviewOpen((value) => !value)} onCopy={onCopy} />
  </div>;
}

function ArtifactPreview({ artifact, preview, previewOpen }: Pick<ArtifactActionProps, "artifact" | "preview" | "previewOpen">) {
  return <div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-foreground">{artifact.title}</p><Badge variant="outline" className="capitalize">{artifactTypeLabel(artifact.type)}</Badge></div>{preview ? previewOpen ? <MarkdownContent>{preview}</MarkdownContent> : <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{preview}</p> : null}</div>;
}

function ArtifactActionControls({ artifact, copy, goalId, goalAssetId, preview, previewOpen, copied, showPreview, copyLabel, onPreviewToggle, onCopy }: ArtifactActionProps) {
  return <div className="flex flex-wrap gap-1.5">
    {showPreview && preview && artifact.operations.canOpen ? <Button type="button" size="sm" variant="outline" onClick={onPreviewToggle}>{previewOpen ? <ChevronUp className="size-4" /> : <SquareArrowOutUpRight className="size-4" />}{previewOpen ? copy.hideDetails : copy.open}</Button> : null}
    {artifact.operations.canCopy ? <CopyArtifactButton copied={copied} copy={copy} copyLabel={copyLabel} onCopy={onCopy} /> : null}
    {artifact.operations.canDownload && artifact.operations.downloadHref ? <Button asChild type="button" size="sm" variant="ghost"><a href={artifact.operations.downloadHref} download><Download className="size-4" />{copy.download}</a></Button> : null}
    <Button asChild type="button" size="sm" variant="ghost"><LocalizedLink href={`/goals/${goalId}?section=workbench${goalAssetId ? `&asset=${encodeURIComponent(goalAssetId)}` : ""}`}><ExternalLink className="size-4" />{copy.showDetails}</LocalizedLink></Button>
  </div>;
}

function CopyArtifactButton({ copied, copy, copyLabel, onCopy }: Pick<ArtifactActionProps, "copied" | "copy" | "copyLabel" | "onCopy">) {
  return <Button type="button" size="sm" variant="ghost" onClick={onCopy}>{copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}{copied ? copy.copied : (copyLabel ?? copy.copy)}</Button>;
}

export function confirmationActorLabel(
  actorType: string,
  actorId: string | null,
  copy: GoalCopy,
) {
  if (actorType === "user" && (!actorId || actorId === "server-action"))
    return copy.currentUser;
  return actorId ?? actorType;
}

export function findPrimaryResultContext(
  goal: GoalData,
  primary: GoalArtifactData | null,
) {
  if (!primary) return null;
  const result = goal.acceptedResults.find(
    (candidate) =>
      candidate.runId === primary.runId ||
      candidate.artifacts.some((artifact) => artifact.id === primary.id),
  );
  const asset = goal.assets.find(
    (candidate) =>
      candidate.currentArtifact.id === primary.id ||
      candidate.sourceArtifact.id === primary.id,
  );
  return { result, asset };
}
