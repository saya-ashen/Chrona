"use client";

import type { ReactNode } from "react";
import { AppLink, type AppLinkProps } from "@/lib/router";
import { useLocale } from "@chrona/i18n/react";
import { localizeHref } from "@chrona/i18n";

type LocalizedLinkProps = Omit<AppLinkProps, "to"> & {
  href: string;
  children?: ReactNode;
};

export function LocalizedLink({ href, children, ...props }: LocalizedLinkProps) {
  const locale = useLocale();

  return (
    <AppLink to={localizeHref(locale, href)} {...props}>
      {children}
    </AppLink>
  );
}
