import {
  Children,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
export {
  Workspace,
  WorkspaceHeader,
  ViewTabs,
  Composer,
  Panel,
  ScrollArea,
  Message,
  CodeDiff,
  ActionOption,
} from "./workspace";
export { Time, CollapsedText } from "./display";
export function Card({ title, description, children }: { title?: string; description?: string; children?: ReactNode }) {
  return (
    <section className="ui-card">
      {title ? <h2>{title}</h2> : null}
      {description ? <p className="muted">{description}</p> : null}
      {children}
    </section>
  );
}
export function Button({
  variant,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "danger" }) {
  return <button type="button" className={`ui-button ${variant ?? ""} ${className}`} {...props} />;
}
export function Input({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="ui-field">
      {label}
      <input className="ui-input" {...props} />
    </label>
  );
}
export function Select({
  label,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) {
  return (
    <label className="ui-field">
      {label}
      <select className="ui-input" {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Stack({ children, row = false }: { children?: ReactNode; row?: boolean }) {
  return <div className={row ? "row" : "ui-stack"}>{children}</div>;
}
export function List({ children, empty = "没有。" }: { children?: ReactNode; empty?: string }) {
  const items = Children.toArray(children);
  return items.length ? (
    <ul className="plain">
      {items.map((item, index) => (
        <li key={typeof item === "object" && "key" in item ? (item.key ?? index) : index}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="muted">{empty}</p>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  label = "内容视图",
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <Button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % items.length
                : event.key === "ArrowLeft"
                  ? (index + items.length - 1) % items.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(items[next]!.value);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
export function Table({ columns, rows, caption }: { columns: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="ui-table">
      <table>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Dialog({
  open,
  title,
  children,
  onClose,
  className = "",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ui-dialog ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
export function Drawer(props: Parameters<typeof Dialog>[0]) {
  return <Dialog {...props} className="ui-drawer" />;
}
export function SplitPane({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="ui-split">
      <div>{sidebar}</div>
      <div>{children}</div>
    </div>
  );
}
// Escape before formatting; links admit only HTTP(S) and local paths.
const inline = (line: string) =>
  line
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] | null = null,
    fence: string[] | null = null;
  const html = (value: string) => ({ dangerouslySetInnerHTML: { __html: inline(value) } });
  for (const [index, line] of content.split("\n").entries()) {
    if (line.startsWith("```")) {
      if (fence) {
        blocks.push(<pre key={index}>{fence.join("\n")}</pre>);
        fence = null;
      } else fence = [];
      list = null;
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const item = markdownListItem(line, index);
    if (item) {
      if (!list) {
        list = [];
        blocks.push(<ul key={index}>{list}</ul>);
      }
      list.push(item);
      continue;
    }
    list = null;
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading)
      blocks.push(
        heading[1]!.length < 3 ? <h3 key={index} {...html(heading[2]!)} /> : <h4 key={index} {...html(heading[2]!)} />,
      );
    else if (line.trim()) blocks.push(<p key={index} {...html(line)} />);
  }
  if (fence) blocks.push(<pre key="end">{fence.join("\n")}</pre>);
  return <div className="markdown">{blocks}</div>;
}

function markdownListItem(line: string, index: number) {
  const task = /^\s*[-*] \[( |x|X)\] (.*)$/.exec(line),
    item = /^\s*[-*] (.*)$/.exec(line);
  if (!task && !item) return null;
  return task ? (
    <li key={index} className="task">
      <input type="checkbox" checked={task[1] !== " "} disabled />
      <span dangerouslySetInnerHTML={{ __html: inline(task[2]!) }} />
    </li>
  ) : (
    <li key={index} dangerouslySetInnerHTML={{ __html: inline(item![1]!) }} />
  );
}
