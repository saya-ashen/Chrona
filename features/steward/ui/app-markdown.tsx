import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { Components } from "react-markdown";
import type { StewardClient } from "../model/client";
import { fileKind, localAppPath } from "../model/app-file";
import { pageHref } from "../model/workspace";
import { AppImage } from "./app-asset";

/** Only local raster images get authenticated bytes; external links never receive owner headers. */
export function useAppMarkdown(client: StewardClient, appId: string, pagePath: string, revision?: string) {
  const { locale } = useI18n();
  return useMemo<Components>(() => ({
    img: ({ src, alt }) => {
      const path = typeof src === "string" ? localAppPath(src, pagePath) : null;
      return path && fileKind(path) === "image" ? <AppImage client={client} appId={appId} path={path} alt={alt} revision={revision} /> : <span>{alt}</span>;
    },
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      const path = localAppPath(href, pagePath);
      if (path) return <Link to={pageHref(locale, appId, path)}>{children}</Link>;
      if (!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return <span>{children}</span>;
      return <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>;
    },
  }), [client, appId, pagePath, locale, revision]);
}
