import { createElement, useMemo } from "react";
import type { LinkProps, To } from "react-router-dom";
import { Link, useLocation, useNavigate, useRevalidator } from "react-router-dom";

import { stripLocalePrefix } from "@/i18n/routing";

export type AppLinkProps = LinkProps;

export type AppRouter = {
  push: (to: To) => void;
  refresh: () => void;
};

export function AppLink(props: AppLinkProps) {
  return createElement(Link, props);
}

export function useAppRouter(): AppRouter {
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return useMemo(
    () => ({
      push: (to: To) => {
        void navigate(to);
      },
      refresh: () => {
        void revalidator.revalidate();
      },
    }),
    [navigate, revalidator],
  );
}

export function useAppPathname() {
  const location = useLocation();
  return stripLocalePrefix(location.pathname);
}
