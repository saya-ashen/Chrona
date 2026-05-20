import type { FormEvent } from "react";
import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AccessKeyUnlockProps = {
  onUnlock: (key: string, remember: boolean) => void;
};

export function AccessKeyUnlock({ onUnlock }: AccessKeyUnlockProps) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    onUnlock(trimmedKey, remember);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#eef6ff_0%,#f8fafc_42%,#eef2f7_100%)] px-4 py-10 text-foreground">
      <section className="w-full max-w-md rounded-[2rem] border border-white/80 bg-white/90 p-7 shadow-2xl shadow-slate-900/10 backdrop-blur sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LockKeyhole className="size-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{t("components.accessKeyUnlock.eyebrow")}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{t("components.accessKeyUnlock.title")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("components.accessKeyUnlock.description")}</p>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-medium text-slate-900">
            {t("components.accessKeyUnlock.keyLabel")}
            <Input
              autoFocus
              className="h-12 rounded-2xl bg-white text-base"
              name="accessKey"
              onChange={(event) => setKey(event.target.value)}
              placeholder={t("components.accessKeyUnlock.keyPlaceholder")}
              type="password"
              value={key}
            />
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-slate-50/80 p-3 text-sm text-muted-foreground">
            <input
              checked={remember}
              className="mt-1 size-4 rounded border-border"
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="block font-medium text-slate-900">{t("components.accessKeyUnlock.rememberLabel")}</span>
              <span>{t("components.accessKeyUnlock.rememberHint")}</span>
            </span>
          </label>

          <Button
            className="h-12 rounded-2xl text-base"
            disabled={!key.trim()}
            type="submit"
          >
            {t("components.accessKeyUnlock.submit")}
          </Button>
        </form>
      </section>
    </main>
  );
}
