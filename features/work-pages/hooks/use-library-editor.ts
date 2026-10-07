import { useEffect, useRef, useState } from "react";
import type { LibraryWriteResult } from "@chrona/contracts";
import { useLibrary, useLibraryCommand } from "./use-library";
import { editorAction, editorCanWrite, editorCurrent, editorDeletion, editorExisting, type LibraryEditor, type LibraryEditorValues } from "../model/library-editor";
export function useLibraryEditor(editor: LibraryEditor, saved: (v: LibraryWriteResult) => void, close: () => void) {
  const state = useLibrary({ view: "catalog", groupId: editor.kind === "folder" ? editor.groupId : undefined });
  const [values, setValues] = useState<LibraryEditorValues>({ name: "", details: "", allowAgent: true }), [revision, setRevision] = useState<string | null>(null), reconcile = useRef(false);
  const command = useLibraryCommand(v => { saved(v); close(); });
  useEffect(() => {
    if (!state.data || state.loading || state.error) return;
    if (revision === null) { setValues(editorCurrent(editor, state.data)); setRevision(state.data.revision); }
    else if (reconcile.current) { setRevision(state.data.revision); reconcile.current = false; }
  }, [state.data, state.loading, state.error, revision, editor]);
  const current = state.data ? editorCurrent(editor, state.data) : null;
  const locked = command.busy || !!command.pending, canWrite = editorCanWrite(editor, state.data);
  const missing = editorExisting(editor) && !current?.name;
  const disabled = locked || state.loading || state.error || !canWrite || !revision || missing;
  return { state, command, current, values, setValues, locked, canWrite, disabled,
    compare: () => { reconcile.current = true; state.refresh(); },
    save: () => { if (revision && !disabled) void command.save(revision, editorAction(editor, values)); },
    remove: () => { const action = editorDeletion(editor); if (revision && !disabled && action) void command.save(revision, action); },
  };
}
