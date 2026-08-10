"use client";

import type { ComponentProps } from "react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { Link } from "react-router-dom";
import { localizeHref } from "@chrona/i18n";
import { useLocale } from "@chrona/i18n"
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@shared/ui";

export type TaskActionsMenuItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
  onSelect?: () => void;
};

type TaskActionsMenuProps = {
  label: string;
  items: TaskActionsMenuItem[];
  buttonClassName?: string;
};

type LocalizedLinkProps = Omit<ComponentProps<typeof Link>, "to"> & { href: string };

function LocalizedLink({ href, ...props }: LocalizedLinkProps) {
  const locale = useLocale();

  return <Link to={localizeHref(locale, href)} {...props} />;
}

export function TaskActionsMenu({ label, items, buttonClassName }: TaskActionsMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
        onClick={() => setOpen(true)}
            type="button"
            aria-label={label}
            variant="ghost"
            size="icon-xs"
            className={buttonClassName ?? "rounded-lg"}
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          {items.map((item) => {
            const Icon = item.icon ?? Ellipsis;
            const content = (
              <>
                <Icon />
                {item.label}
              </>
            );

            if (item.href && !item.disabled) {
              return (
                <DropdownMenuItem key={item.id} render={<LocalizedLink href={item.href} />}>
                  {content}
                </DropdownMenuItem>
              );
            }

            return (
              <DropdownMenuItem
                key={item.id}
                disabled={item.disabled}
                title={item.disabledReason}
                variant={item.destructive ? "destructive" : "default"}
                onClick={item.onSelect}
              >
                {content}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
