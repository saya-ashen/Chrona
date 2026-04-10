import { redirect } from "next/navigation";
import { resolveLocale } from "@/i18n/config";
import { localizeHref } from "@/i18n/routing";

export default async function LocalizedHomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(localizeHref(resolveLocale(lang), "/schedule"));
}
