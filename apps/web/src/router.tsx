import { createBrowserRouter, Navigate, useLocation, useParams } from "react-router-dom";
import { defaultLocale, hasLocale, resolveLocale } from "@chrona/i18n";
import { AppShell } from "./app-shell";
import { AccessKeyRouteError } from "@/components/access-key-route-error";
import { TodayRoutePage } from "./pages";
import { SettingsPage, AffairsPage, AffairDetailPage } from "@features/steward";
import { NotFoundPage } from "@/components/not-found-page";
import { loadAppBootData } from "./loaders";

function LocaleRedirect({ today = false }: { today?: boolean }) {
  const { search, hash } = useLocation();
  const { lang } = useParams();
  return <Navigate to={`/${today ? resolveLocale(lang) : defaultLocale}${search}${hash}`} replace />;
}

/** Links Chrona sends out (QQ, notifications) carry no locale: keep the path and query under the default one. */
function UnlocalizedRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/${defaultLocale}${pathname}${search}${hash}`} replace />;
}

function loadLocaleBootData(args: Parameters<typeof loadAppBootData>[0]) {
  if (!args.params.lang || !hasLocale(args.params.lang)) {
    throw new Response(null, { status: 404 });
  }
  return loadAppBootData(args);
}

export function createAppRouter() {
  return createBrowserRouter([
    { path: "/", element: <LocaleRedirect /> },
    { path: "/affairs/*", element: <UnlocalizedRedirect /> },
    { path: "/settings", element: <UnlocalizedRedirect /> },
    {
      path: "/:lang",
      loader: loadLocaleBootData,
      element: <AppShell />,
      errorElement: <AccessKeyRouteError />,
      hydrateFallbackElement: <div aria-hidden="true" />,
      children: [
        { index: true, element: <TodayRoutePage /> },
        { path: "today", element: <LocaleRedirect today /> },
        { path: "affairs", element: <AffairsPage /> },
        { path: "affairs/:affairId", element: <AffairDetailPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ]);
}
