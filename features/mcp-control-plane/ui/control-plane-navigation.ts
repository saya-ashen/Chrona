import { Bell, CalendarDays, ClipboardList, FileText, Inbox, LayoutDashboard, Settings, Target, Sun, ShieldCheck, Plug } from "lucide-react";
import type { useI18n } from "@chrona/i18n";
type NavEntry = { href: string; label: string; icon: typeof CalendarDays; active: boolean };
/** Steward first; legacy work remains reachable without claiming new authority. */
export function controlPlaneNavigation(pathname: string, messages: ReturnType<typeof useI18n>["messages"]) {
  const nav = messages.nav;
  const advancedNavItems: NavEntry[] = [
    { href: "/dashboard", label: nav.dashboard, icon: LayoutDashboard, active: pathname.startsWith("/dashboard") },
    { href: "/work", label: messages.workRecords.title, icon: Inbox, active: pathname === "/work" || pathname.endsWith("/work") },
    { href: "/goals", label: nav.goals, icon: Target, active: pathname.startsWith("/goals") },
    { href: "/tasks", label: nav.tasks, icon: ClipboardList, active: pathname === "/tasks" || pathname.startsWith("/tasks/") },
    { href: "/home", label: messages.workPages.home, icon: FileText, active: pathname === "/home" },
    { href: "/action-center", label: nav.actionCenter, icon: Bell, active: pathname.startsWith("/action-center") },
    { href: "/settings", label: nav.settings, icon: Settings, active: pathname.startsWith("/settings") },
  ];
  const navItems: NavEntry[] = [
    { href: "/today", label: messages.steward.today, icon: Sun, active: pathname === "/today" },
    { href: "/affairs", label: messages.steward.affairs, icon: Inbox, active: pathname === "/affairs" || pathname.startsWith("/affairs/") },
    { href: "/schedule", label: nav.schedule, icon: CalendarDays, active: pathname.startsWith("/schedule") },
    { href: "/delegations", label: messages.steward.delegations, icon: ShieldCheck, active: pathname === "/delegations" },
    { href: "/connections", label: messages.steward.connections, icon: Plug, active: pathname === "/connections" },
  ];
  return { navItems, advancedNavItems };
}
