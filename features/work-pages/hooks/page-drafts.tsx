import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@shared/ui";
const DraftContext = createContext<{ dirty: boolean; hasOtherDraft: (key: string) => boolean; mark: (key: string, dirty: boolean) => void } | null>(null);
export const usePageDrafts = () => useContext(DraftContext);
export function PageDraftProvider({ children }: { children: ReactNode }) {
  const c = useI18n().messages.workPages, [keys, setKeys] = useState<Set<string>>(new Set());
  const mark = useCallback((key: string, dirty: boolean) => setKeys((prev) => { const next = new Set(prev); if (dirty) next.add(key); else next.delete(key); return next; }), []);
  const blocker = useBlocker(keys.size > 0);
  return <DraftContext.Provider value={{ dirty: keys.size > 0, hasOtherDraft: (key) => [...keys].some((k) => k !== key), mark }}>{children}
    <Dialog open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && blocker.state === "blocked") blocker.reset(); }}><DialogContent><DialogTitle>{c.unsaved}</DialogTitle><DialogDescription>{c.leaveDraft}</DialogDescription><DialogFooter><Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>{c.stay}</Button><Button onClick={() => blocker.state === "blocked" && blocker.proceed()}>{c.leave}</Button></DialogFooter></DialogContent></Dialog>
  </DraftContext.Provider>;
}
