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
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn("border-b border-panel-border pb-4 pt-1 sm:pb-5", className)}
      {...props}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <div data-slot="page-header-eyebrow" className="mb-1.5 text-xs font-medium text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1
              data-slot="page-header-title"
              className={cn("text-2xl font-semibold tracking-tight text-foreground sm:text-3xl", titleClassName)}
            >
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <div data-slot="page-header-description" className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
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
