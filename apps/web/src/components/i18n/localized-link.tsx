"use client";

import type { ReactNode } from "react";
import { AppLink, type AppLinkProps } from "@/lib/router";
import { useLocale } from "@/i18n/client";
import { localizeHref } from "@/i18n/routing";

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
