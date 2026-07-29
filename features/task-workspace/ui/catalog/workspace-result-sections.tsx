import type { ReactNode } from "react";
import { cn } from "@shared/ui";
import { stringField, stringProp } from "./workspace-registry-utilities";
import { CollapsibleBlock } from "./workspace-collapse";

export function ResultSection({
  props,
  children,
}: {
  props: Record<string, unknown>;
  children?: ReactNode;
}) {
  const layout = stringProp(props.layout) ?? "stack";
  const tone = stringProp(props.tone) ?? "default";
  const body = (
    <div
      className={cn(
        "mt-3 min-w-0",
        layout === "grid" && "grid gap-4 sm:grid-cols-2",
        layout === "split" && "grid gap-5 lg:grid-cols-2",
        layout === "rail" &&
          "flex gap-4 overflow-x-auto pb-2 [&>*]:min-w-[18rem] [&>*]:flex-1",
        layout === "stack" && "space-y-4",
      )}
    >
      {children}
    </div>
  );
  if (props.defaultCollapsed === true)
    return (
      <CollapsibleBlock
        title={stringProp(props.title)}
        summary={stringProp(props.summary)}
        defaultCollapsed
      >
        {body}
      </CollapsibleBlock>
    );
  return (
    <section
      className={cn(
        "min-w-0",
        tone === "subtle" && "rounded-2xl bg-muted/35 p-4 sm:p-5",
        tone === "accent" &&
          "rounded-2xl border border-primary/20 bg-primary-soft/30 p-4 sm:p-5",
      )}
    >
      <h2 className="font-heading text-lg font-semibold text-foreground">
        {stringProp(props.title) ?? "Result section"}
      </h2>
      {typeof props.summary === "string" ? (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {props.summary}
        </p>
      ) : null}
      {body}
    </section>
  );
}

export function ResultMetricGrid({ props }: { props: Record<string, unknown> }) {
  const items = Array.isArray(props.items)
    ? props.items.filter(
        (item): item is { label: string; value: string; detail?: string } =>
          stringField(item, "label") !== undefined &&
          stringField(item, "value") !== undefined,
      )
    : [];
  return (
    <section className="min-w-0">
      {typeof props.title === "string" ? (
        <h3 className="mb-3 font-heading text-base font-semibold">
          {props.title}
        </h3>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={`${item.label}:${item.value}`}
            className="rounded-xl border border-border/60 bg-background p-4"
          >
            <p className="text-xs font-medium text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 font-heading text-xl font-semibold text-foreground">
              {item.value}
            </p>
            {item.detail ? (
              <p className="mt-1 text-xs leading-4 text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

