import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useSearchParams,
  type LinkProps as RouterLinkProps,
} from "react-router-dom";

export type AppLinkProps = RouterLinkProps;

export const AppLink = RouterLink;

export function useAppPathname() {
  return useLocation().pathname;
}

export function useAppSearchParams() {
  return useSearchParams();
}

export function useAppRouter() {
  const navigate = useNavigate();

  return {
    push(href: string) {
      navigate(href);
    },
    replace(href: string) {
      navigate(href, { replace: true });
    },
    refresh() {
      navigate(0);
    },
    back() {
      navigate(-1);
    },
  };
}
