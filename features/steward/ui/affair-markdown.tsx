import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { Components } from "react-markdown";
import type { StewardClient } from "../model/client";
import { fileKind, localAffairPath } from "../model/affair-file";
import { pageHref } from "../model/workspace";
import { AffairImage } from "./affair-asset";

/** Only local raster images get authenticated bytes; external links never receive owner headers. */
export function useAffairMarkdown(client: StewardClient, affairId: string, pagePath: string, revision?: string) {
  const { locale } = useI18n();
  return useMemo<Components>(() => ({
    img: ({ src, alt }) => {
      const path = typeof src === "string" ? localAffairPath(src, pagePath) : null;
      return path && fileKind(path) === "image" ? <AffairImage client={client} affairId={affairId} path={path} alt={alt} revision={revision} /> : <span>{alt}</span>;
    },
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      const path = localAffairPath(href, pagePath);
      if (path) return <Link to={pageHref(locale, affairId, path)}>{children}</Link>;
      if (!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return <span>{children}</span>;
      return <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>;
    },
  }), [client, affairId, pagePath, locale, revision]);
}
