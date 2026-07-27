import * as React from "react";

import { cn } from "./utils";

const pageFrameWidths = {
  main: "max-w-[1440px]",
  workspace: "max-w-[1600px]",
} as const;

export type PageFrameMode = keyof typeof pageFrameWidths;

export function PageFrame({
  mode,
  className,
  ...props
}: React.ComponentProps<"div"> & { mode: PageFrameMode }) {
  return (
    <div
      data-slot="page-frame"
      data-mode={mode}
      className={cn(
        "mx-auto flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden overflow-y-auto",
        pageFrameWidths[mode],
        className,
      )}
      {...props}
    />
  );
}
