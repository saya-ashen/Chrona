import type { LoaderFunctionArgs } from "react-router-dom";
import { getDictionary, resolveLocale } from "@chrona/i18n";
import { apiJson } from "../../../shared/http/api-client";
import type { AppBootData } from "./pages";

export async function loadAppBootData({ params, request }: LoaderFunctionArgs): Promise<AppBootData> {
  const locale = resolveLocale(params.lang);
  const dictionary = await getDictionary(locale);
  const origin = new URL(request.url).origin;
  const workspaces = await apiJson<AppBootData["defaultWorkspace"][]>(`${origin}/api/workspaces`);
  const defaultWorkspace = workspaces.at(0);
  if (!defaultWorkspace) throw new Response(null, { status: 503 });
  return { locale, dictionary, defaultWorkspace };
}
