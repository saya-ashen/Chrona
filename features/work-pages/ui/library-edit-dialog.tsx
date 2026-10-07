import { useI18n } from "@chrona/i18n";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Textarea } from "@shared/ui";
import type { LibraryWriteResult } from "@chrona/contracts";
import { useLibraryEditor } from "../hooks/use-library-editor";
import { editorExisting, editorTitle, type LibraryEditor } from "../model/library-editor";
import { LibraryCommandFeedback, LibraryReadFeedback } from "./library-feedback";
export type { LibraryEditor } from "../model/library-editor";
type EditorModel = ReturnType<typeof useLibraryEditor>;
function EditorFields({ editor, model }: { editor: LibraryEditor; model: EditorModel }) {
  const { messages } = useI18n(), c = messages.library, { values, setValues } = model, group = editor.kind === "group";
  return <>
    <div className="space-y-2"><Label htmlFor="library-name">{c.name}</Label><Input id="library-name" autoFocus required maxLength={100} value={values.name} disabled={model.locked || model.state.loading} onChange={e => setValues({ ...values, name: e.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor="library-instructions">{group ? c.instructions : c.description}</Label><Textarea id="library-instructions" rows={4} maxLength={group ? 2000 : 300} value={values.details} disabled={model.locked || model.state.loading} onChange={e => setValues({ ...values, details: e.target.value })} placeholder={group ? c.instructionsHint : undefined} /></div>
    {group && <Label className="flex items-start gap-3"><Checkbox checked={values.allowAgent} disabled={model.locked} onCheckedChange={v => setValues({ ...values, allowAgent: v === true })} />{c.allowAgent}</Label>}
  </>;
}
function EditorActions({ editor, model, close }: { editor: LibraryEditor; model: EditorModel; close: () => void }) {
  const { messages } = useI18n(), c = messages.library;
  return <div className="flex flex-wrap justify-end gap-2">{editorExisting(editor) && <Button type="button" variant="destructive" className="mr-auto" disabled={model.disabled} onClick={() => { if (window.confirm(c.deleteConfirm)) model.remove(); }}>{c.delete}</Button>}<Button type="button" variant="ghost" disabled={model.locked} onClick={close}>{c.cancel}</Button>{!model.command.pending && <Button type="submit" disabled={model.disabled || !model.values.name.trim()}>{c.save}</Button>}</div>;
}
export function LibraryEditDialog({ editor, close, saved }: { editor: LibraryEditor; close: () => void; saved: (value: LibraryWriteResult) => void }) {
  const { messages } = useI18n(), c = messages.library, model = useLibraryEditor(editor, saved, close);
  return <Dialog open onOpenChange={v => { if (!v && !model.locked) close(); }}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{c[editorTitle(editor)]}</DialogTitle><DialogDescription>{editor.kind === "group" ? c.groupHint : c.folderHint}</DialogDescription></DialogHeader>
    <LibraryReadFeedback state={model.state} />
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); model.save(); }}>
      <EditorFields editor={editor} model={model} />
      {!model.state.loading && !model.canWrite && <p className="text-sm text-muted-foreground">{c.readOnly}</p>}
      {editorExisting(editor) && model.current && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">{c.currentSaved}</summary><p className="mt-2 whitespace-pre-wrap break-words">{model.current.name}<br />{model.current.details}</p></details>}
      <LibraryCommandFeedback command={model.command} refresh={model.compare} />
      <EditorActions editor={editor} model={model} close={close} />
    </form>
  </DialogContent></Dialog>;
}
