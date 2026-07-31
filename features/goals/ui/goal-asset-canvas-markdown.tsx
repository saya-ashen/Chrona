"use client";

import { useState } from "react";
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

export type MarkdownAssetCanvasProps = {
  value: string;
  diffValue?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
};

function MarkdownEditor({ value, diffValue, ariaLabel, onChange }: MarkdownAssetCanvasProps) {
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
    diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: diffValue ?? value }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper options={["rich-text", "source", "diff"]}>
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
      plugins={plugins}
      trim={false}
      contentEditableClassName="prose mx-auto min-h-full w-full max-w-[52rem] px-5 py-7 text-base leading-7 outline-none sm:px-10 sm:py-10"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background [&_.mdxeditor-diff-source-wrapper]:flex [&_.mdxeditor-diff-source-wrapper]:min-h-0 [&_.mdxeditor-diff-source-wrapper]:flex-1 [&_.mdxeditor-diff-source-wrapper]:flex-col [&_.mdxeditor-diff-source-wrapper]:overflow-hidden [&_.mdxeditor-rich-text-editor]:flex! [&_.mdxeditor-rich-text-editor]:min-h-0 [&_.mdxeditor-rich-text-editor]:flex-1 [&_.mdxeditor-rich-text-editor]:flex-col [&_.mdxeditor-root-contenteditable]:min-h-0 [&_.mdxeditor-root-contenteditable]:flex-1 [&_.mdxeditor-root-contenteditable]:overflow-y-auto [&_[role=toolbar]]:shrink-0 [&_[role=toolbar]]:rounded-none [&_[role=toolbar]]:border-b"
    />
  );
}

export function MarkdownAssetCanvas(props: MarkdownAssetCanvasProps) {
  return (
    <section aria-label={props.ariaLabel} data-asset-canvas="document" data-asset-canvas-mode="edit" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-xs">
      <MarkdownEditor {...props} />
    </section>
  );
}
