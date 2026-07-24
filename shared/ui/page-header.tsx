import * as React from "react";

import { cn } from "./utils";

type PageHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  titleClassName?: string;
  surface?: "plain" | "workspace";
};

export function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  toolbar,
  className,
  titleClassName,
  surface = "plain",
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        surface === "workspace"
          ? "relative overflow-hidden border-y border-panel-border bg-muted/70 px-4 py-3 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary sm:px-5 sm:py-3.5"
          : "border-b border-panel-border pb-4 pt-1 sm:pb-5",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <div data-slot="page-header-eyebrow" className="mb-0.5 text-xs font-medium text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1
              data-slot="page-header-title"
              className={cn("text-xl font-semibold tracking-tight text-foreground sm:text-2xl", surface === "workspace" && "w-full", titleClassName)}
            >
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <div data-slot="page-header-description" className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div data-slot="page-header-actions" className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {toolbar ? (
        <div data-slot="page-header-toolbar" className="mt-3">
          {toolbar}
        </div>
      ) : null}
    </header>
  );
}
