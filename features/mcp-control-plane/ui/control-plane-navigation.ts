import { Bell, CalendarDays, ClipboardList, FileText, Inbox, LayoutDashboard, Settings, Target } from "lucide-react";
import type { useI18n } from "@chrona/i18n";
type NavEntry = { href: string; label: string; icon: typeof CalendarDays; active: boolean };
/** Ordinary work first. Existing professional tools stay reachable, not removed. */
export function controlPlaneNavigation(pathname: string, messages: ReturnType<typeof useI18n>["messages"]) {
  const nav = messages.nav;
  const advancedNavItems: NavEntry[] = [
    { href: "/dashboard", label: nav.dashboard, icon: LayoutDashboard, active: pathname.startsWith("/dashboard") },
    { href: "/work", label: messages.workRecords.title, icon: Inbox, active: pathname === "/work" || pathname.endsWith("/work") },
    { href: "/goals", label: nav.goals, icon: Target, active: pathname.startsWith("/goals") },
    { href: "/tasks", label: nav.tasks, icon: ClipboardList, active: pathname === "/tasks" },
    { href: "/settings", label: nav.settings, icon: Settings, active: pathname.startsWith("/settings") },
  ];
  const navItems: NavEntry[] = [
    { href: "/home", label: messages.workPages.home, icon: FileText, active: pathname === "/home" || pathname.startsWith("/tasks/") },
    { href: "/schedule", label: nav.schedule, icon: CalendarDays, active: pathname.startsWith("/schedule") },
    { href: "/action-center", label: nav.actionCenter, icon: Bell, active: pathname.startsWith("/action-center") },
  ];
  return { navItems, advancedNavItems };
}
