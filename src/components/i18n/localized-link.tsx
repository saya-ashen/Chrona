"use client";

import Link, { type LinkProps } from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useLocale } from "@/i18n/client";
import { localizeHref } from "@/i18n/routing";

type LocalizedLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> &
  Omit<LinkProps, "href"> & {
    href: string;
    children?: ReactNode;
  };

export function LocalizedLink({ href, children, ...props }: LocalizedLinkProps) {
  const locale = useLocale();

  return (
    <Link href={localizeHref(locale, href)} {...props}>
      {children}
    </Link>
  );
}
