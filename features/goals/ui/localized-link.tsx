"use client";

import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";
import { localizeHref, useLocale } from "@chrona/i18n";

type LocalizedLinkProps = Omit<ComponentProps<typeof Link>, "to"> & {
  href: string;
  children?: ReactNode;
};

export function LocalizedLink({ href, children, ...props }: LocalizedLinkProps) {
  const locale = useLocale();
  return <Link to={localizeHref(locale, href)} {...props}>{children}</Link>;
}
