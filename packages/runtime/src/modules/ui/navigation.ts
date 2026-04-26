export type ControlPlaneNavItem = {
  href: string;
  labelKey: string;
};

export const NAV_ITEMS: ControlPlaneNavItem[] = [
  {
    href: "/schedule",
    labelKey: "nav.schedule",
  },
  {
    href: "/inbox",
    labelKey: "nav.inbox",
  },
  {
    href: "/memory",
    labelKey: "nav.memory",
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
  },
];
