import { useI18n } from "@chrona/i18n";

/** Existing task context, not an authored result or a user note. */
export function PageTaskDescription({ description }: { description?: string | null }) {
  const { messages } = useI18n();
  const c = messages.workPages;
  if (!description?.trim()) return <p className="text-muted-foreground">{c.blank}</p>;
  return (
    <section className="space-y-3" aria-label={c.taskDescription} data-ui-surface-kind="product-authored">
      <h2 className="text-lg font-semibold">{c.taskDescription}</h2>
      <p className="max-w-[75ch] whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">{description}</p>
    </section>
  );
}
