import { useState } from "react";
import {
  ArrowRight,
  Download,
  Eye,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from "@shared/ui";
import { formatFileSize, stringProp } from "./workspace-registry-utilities";
import { WorkspaceTable } from "./workspace-table";

type DeliverableProps = Record<string, unknown>;

function deliverableIcon(kind: string) {
  if (kind === "table" || kind === "dataset") return FileSpreadsheet;
  if (kind === "image") return FileImage;
  if (kind === "archive") return FileArchive;
  if (kind === "code") return FileCode2;
  return FileText;
}

function roleLabel(role: string, copy: Record<string, string | undefined>) {
  if (role === "primary")
    return copy.resultPrimaryDeliverable ?? "Primary deliverable";
  if (role === "evidence") return copy.resultEvidenceMaterial ?? "Evidence";
  return copy.resultSupportingMaterial ?? "Supporting material";
}

function DeliverableActions({
  downloadHref,
  isPrimary,
  openAssetHref,
  onPreview,
  previewAvailable,
}: {
  downloadHref?: string;
  isPrimary: boolean;
  openAssetHref?: string;
  onPreview: () => void;
  previewAvailable: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {openAssetHref ? (
        <Button asChild size="sm" variant={isPrimary ? "default" : "outline"}>
          <Link to={openAssetHref}>
            <ArrowRight className="size-3.5" aria-hidden />
            {copy.openWorkbenchAsset ?? "Open asset"}
          </Link>
        </Button>
      ) : null}
      {previewAvailable ? (
        <Button
          type="button"
          size="sm"
          variant={isPrimary ? "default" : "outline"}
          onClick={onPreview}
        >
          <Eye className="size-3.5" aria-hidden />
          {copy.artifactPreview ?? "Preview"}
        </Button>
      ) : null}
      {downloadHref ? (
        <Button asChild size="sm" variant={isPrimary ? "outline" : "ghost"}>
          <a href={downloadHref} download>
            <Download className="size-3.5" aria-hidden />
            {copy.downloadArtifact ?? "Download"}
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function ContentPreview({
  content,
  kind,
  title,
}: {
  content: string;
  kind?: string;
  title: string;
}) {
  if (kind === "csv" || kind === "json")
    return (
      <WorkspaceTable
        props={{ contentKind: kind, contentPreview: content, wide: true }}
      />
    );
  const heading =
    content.split("\n").find(Boolean)?.replace(/^#\s*/, "") ?? title;
  return (
    <article className="text-base leading-7 text-foreground/85">
      <h2 className="font-heading">{heading}</h2>
      <pre className="whitespace-pre-wrap break-words">{content}</pre>
    </article>
  );
}

function DeliverablePreview({
  content,
  kind,
  onOpenChange,
  open,
  title,
}: {
  content: string;
  kind?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-result-content-preview
        className="left-0! right-0! mx-auto w-full max-w-[70rem]! rounded-2xl overflow-y-auto"
      >
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>{title}</SheetTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={copy.closeResultPreview ?? "Close preview"}
              onClick={() => onOpenChange(false)}
            >
              <X />
            </Button>
          </div>
          <SheetDescription>
            {copy.resultContentPreview ?? "Content preview"}
          </SheetDescription>
        </SheetHeader>
        <main className="mt-6">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <ContentPreview content={content} kind={kind} title={title} />
          </div>
        </main>
      </SheetContent>
    </Sheet>
  );
}

function DeliverableCard({
  formatLabel,
  isPrimary,
  kind,
  props,
  role,
  title,
}: {
  formatLabel: string;
  isPrimary: boolean;
  kind: string;
  props: DeliverableProps;
  role: string;
  title: string;
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const Icon = deliverableIcon(kind);
  const summary = stringProp(props.summary);
  const preview = stringProp(props.contentPreview);
  const previewKind = stringProp(props.contentKind);
  const size = formatFileSize(props.contentBytes);
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
      <article
        data-result-deliverable-role={role}
        className={cn(
          "group min-w-0 overflow-hidden rounded-xl border transition-colors",
          isPrimary
            ? "border-primary/25 bg-primary-soft/45 p-5 sm:p-6"
            : "border-border/70 bg-background p-4 hover:border-primary/25",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg",
              isPrimary
                ? "size-10 bg-primary text-primary-foreground"
                : "size-9 bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {roleLabel(role, copy)} · {formatLabel}
              {size ? ` · ${size}` : ""}
            </p>
            <h3
              className={cn(
                "mt-1.5 break-words font-heading font-semibold leading-snug tracking-[-0.015em] text-foreground",
                isPrimary ? "text-xl sm:text-2xl" : "text-base",
              )}
            >
              {title}
            </h3>
            {summary ? (
              <p
                className={cn(
                  "mt-2 text-foreground/70",
                  isPrimary
                    ? "max-w-2xl text-sm leading-6"
                    : "text-xs leading-5",
                )}
              >
                {summary}
              </p>
            ) : null}
            <DeliverableActions
              openAssetHref={stringProp(props.openAssetHref)}
              downloadHref={stringProp(props.downloadHref)}
              isPrimary={isPrimary}
              previewAvailable={Boolean(
                preview && props.suppressContentPreview !== true,
              )}
              onPreview={() => setPreviewOpen(true)}
            />
          </div>
        </div>
      </article>
      {preview && props.suppressContentPreview !== true ? (
        <DeliverablePreview
          content={preview}
          kind={previewKind}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={title}
        />
      ) : null}
    </>
  );
}

export function ResultDeliverable({ props }: { props: DeliverableProps }) {
  const title = stringProp(props.title) ?? "Deliverable";
  const role = stringProp(props.role) ?? "supporting";
  const kind = stringProp(props.kind) ?? "other";
  return (
    <DeliverableCard
      props={props}
      title={title}
      role={role}
      kind={kind}
      formatLabel={stringProp(props.formatLabel) ?? kind}
      isPrimary={role === "primary"}
    />
  );
}
