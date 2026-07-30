"use client";

import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  frontmatterPlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import {
  MarkdownContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/ui";

export type MarkdownAssetCanvasProps = {
  mode: "read" | "edit";
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  sourceModeLabel?: string;
  richModeLabel?: string;
  previewModeLabel?: string;
};

function RichMarkdownEditor({ value, ariaLabel, onChange, onParseError }: {
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onParseError: () => void;
}) {
  const [plugins] = useState(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
    codeMirrorPlugin({ codeBlockLanguages: { txt: "Plain text", js: "JavaScript", ts: "TypeScript", json: "JSON", css: "CSS", html: "HTML", bash: "Shell" } }),
    frontmatterPlugin(),
    diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: value, codeMirrorExtensions: [markdownLanguage()] }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper options={["rich-text", "diff"]}>
          <UndoRedo />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <ListsToggle />
          <CreateLink />
          <InsertTable />
          <InsertCodeBlock />
        </DiffSourceToggleWrapper>
      ),
    }),
  ]);
  return (
    <MDXEditor
      aria-label={ariaLabel}
      markdown={value}
      onChange={(markdown, initialMarkdownNormalize) => { if (!initialMarkdownNormalize) onChange(markdown); }}
      onError={onParseError}
      plugins={plugins}
      trim={false}
      contentEditableClassName="prose mx-auto min-h-full w-full max-w-[52rem] px-5 py-7 text-base leading-7 outline-none sm:px-10 sm:py-10"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background [&_.mdxeditor-diff-source-wrapper]:flex [&_.mdxeditor-diff-source-wrapper]:min-h-0 [&_.mdxeditor-diff-source-wrapper]:flex-1 [&_.mdxeditor-diff-source-wrapper]:flex-col [&_.mdxeditor-diff-source-wrapper]:overflow-hidden [&_.mdxeditor-rich-text-editor]:flex! [&_.mdxeditor-rich-text-editor]:min-h-0 [&_.mdxeditor-rich-text-editor]:flex-1 [&_.mdxeditor-rich-text-editor]:flex-col [&_.mdxeditor-root-contenteditable]:min-h-0 [&_.mdxeditor-root-contenteditable]:flex-1 [&_.mdxeditor-root-contenteditable]:overflow-y-auto [&_[role=toolbar]]:shrink-0 [&_[role=toolbar]]:rounded-none [&_[role=toolbar]]:border-b"
    />
  );
}

export function MarkdownAssetCanvas({
  mode,
  value,
  ariaLabel,
  onChange,
  sourceModeLabel = "Source",
  richModeLabel = "Rich text",
  previewModeLabel = "Preview",
}: MarkdownAssetCanvasProps) {
  const [editorMode, setEditorMode] = useState<"source" | "rich">("source");

  if (mode === "edit") {
    return (
      <section data-asset-canvas="document" data-asset-canvas-mode="edit" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-xs">
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b bg-muted/20 px-3 py-1.5">
          <p className="min-w-0 truncate text-sm text-muted-foreground">{ariaLabel}</p>
          <Select value={editorMode} onValueChange={(next) => setEditorMode(next as "source" | "rich")}>
            <SelectTrigger size="sm" aria-label={ariaLabel} className="min-h-11 min-w-36 bg-background sm:min-h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="source">{sourceModeLabel}</SelectItem>
              <SelectItem value="rich">{richModeLabel}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1">
          {editorMode === "source" ? (
            <div aria-label={ariaLabel} className="h-full min-h-0">
              <CodeMirror
                aria-label={ariaLabel}
                value={value}
                height="100%"
                extensions={[markdownLanguage()]}
                onChange={onChange}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true, autocompletion: false }}
                className="h-full min-h-0 text-[0.9375rem] [&_.cm-content]:px-3 [&_.cm-content]:py-5 [&_.cm-editor]:h-full [&_.cm-editor]:min-h-0 [&_.cm-scroller]:h-full [&_.cm-scroller]:overflow-auto [&_.cm-scroller]:font-mono [&_.cm-scroller]:leading-7 [&_.cm-scroller]:outline-none"
              />
            </div>
          ) : (
            <RichMarkdownEditor
              key={`${ariaLabel}-rich`}
              value={value}
              ariaLabel={ariaLabel}
              onChange={onChange}
              onParseError={() => setEditorMode("source")}
            />
          )}
        </div>
      </section>
    );
  }
  return (
    <section aria-label={`${ariaLabel} · ${previewModeLabel}`} data-asset-canvas="document" data-asset-canvas-mode="read" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-xs">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <MarkdownContent className="mx-auto max-w-[52rem] px-5 py-7 text-base leading-7 sm:px-10 sm:py-10 [&>div]:space-y-4">{value}</MarkdownContent>
      </div>
    </section>
  );
}
