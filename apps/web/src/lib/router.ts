import type { LinkProps } from "react-router-dom";
import { Link, useLocation } from "react-router-dom";

import { stripLocalePrefix } from "@/i18n/routing";

export type AppLinkProps = LinkProps;

export function AppLink(props: AppLinkProps) {
  return Link(props);
}

export function useAppPathname() {
  const location = useLocation();
  return stripLocalePrefix(location.pathname);
}
