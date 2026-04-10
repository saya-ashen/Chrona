import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/config";
import { localizeHref } from "@/i18n/routing";

export default function HomePage() {
  redirect(localizeHref(defaultLocale, "/schedule"));
}
