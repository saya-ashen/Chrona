export type ControlPlaneNavItem = {
  href: string;
  label: string;
};

export const NAV_ITEMS: ControlPlaneNavItem[] = [
  {
    href: "/workspaces",
    label: "Workspaces",
  },
  {
    href: "/tasks",
    label: "Tasks",
  },
  {
    href: "/inbox",
    label: "Inbox",
  },
  {
    href: "/memory",
    label: "Memory",
  },
  {
    href: "/settings",
    label: "Settings",
  },
];
