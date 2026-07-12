import type { LucideIcon } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Button } from "shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "shared/ui/dropdown-menu";

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

export function TaskActionsMenu({ label, items, buttonClassName }: TaskActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
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
