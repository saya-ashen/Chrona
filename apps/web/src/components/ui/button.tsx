import { cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium select-none outline-none transition-all duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_3px_var(--color-primary)/0.15,0_0_0_1px_var(--color-primary)/0.02] hover:bg-primary/90 hover:shadow-[0_4px_10px_-3px_var(--color-primary)/0.22]",
        outline:
          "border border-border/80 bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:border-primary/30 hover:bg-primary/[0.03] hover:text-primary dark:hover:bg-primary/[0.06]",
        soft: "bg-primary-soft text-primary border border-primary-border hover:bg-primary-soft-hover",
        secondary: "bg-primary/[0.07] text-primary hover:bg-primary/[0.11]",
        ghost: "text-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/15 hover:bg-destructive/15 hover:border-destructive/25 active:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px] gap-1.5 [&_svg]:size-3.5",
        default: "h-9 px-4 gap-2",
        lg: "h-10 px-5 text-[15px] gap-2 [&_svg]:size-[18px]",
        xs: "h-7 px-2.5 text-xs gap-1 [&_svg]:size-3",
        icon: "size-9",
        "icon-sm": "size-8 [&_svg]:size-3.5",
        "icon-xs": "size-7 [&_svg]:size-3",
        "icon-lg": "size-10 [&_svg]:size-[18px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export { buttonVariants };
