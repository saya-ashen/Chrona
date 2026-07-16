import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@shared/ui";

export function TaskMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "min-w-0 w-full max-w-full overflow-hidden px-0.5 py-1 text-sm leading-6 text-foreground",
        className,
      )}
    >
      <div className="max-w-none space-y-2 break-words [overflow-wrap:anywhere] [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_blockquote]:rounded-lg [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary-soft/45 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-foreground/80 [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_code]:text-foreground [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:font-heading [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-tight [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:border-border [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:text-foreground/88 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/70 [&_pre]:p-3 [&_pre]:text-xs [&_strong]:text-foreground [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_td]:break-words [&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:p-1.5 [&_th]:text-left [&_th]:break-words [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
      </div>
    </article>
  );
}
