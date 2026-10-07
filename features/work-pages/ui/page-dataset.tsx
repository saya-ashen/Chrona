import { useMemo, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Input } from "@shared/ui";
import type { PageDataset } from "@chrona/ui-protocol";
export function PageDatasetView({ data, title, searchable = true, comparison = false }: { data: PageDataset; title?: string; searchable?: boolean; comparison?: boolean }) {
  const c = useI18n().messages.workPages, [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const rows = useMemo(() => {
    const filtered = data.rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLocaleLowerCase().includes(filter.toLocaleLowerCase())));
    if (sort) filtered.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""))) * (sort.descending ? -1 : 1);
    });
    return filtered;
  }, [data, filter, sort]);
  return <section className="min-w-0 space-y-3">
    {title && <h2 className="text-lg font-semibold">{title}</h2>}
    {searchable && <Input aria-label={c.filter} placeholder={c.filter} value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />}
    {comparison ? <div className="grid gap-4 md:grid-cols-2">{rows.map((row, i) => <dl key={i} className="space-y-3 rounded-xl border p-4">{data.columns.map((col) => <div key={col.key}><dt className="text-xs text-muted-foreground">{col.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{String(row[col.key] ?? "—")}</dd></div>)}</dl>)}</div>
      : <div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>{data.columns.map((col) => <th key={col.key} scope="col" aria-sort={sort?.key === col.key ? sort.descending ? "descending" : "ascending" : "none"}><Button size="sm" variant="ghost" className="h-auto whitespace-normal text-left" aria-label={`${c.sort}: ${col.label}`} onClick={() => setSort({ key: col.key, descending: sort?.key === col.key ? !sort.descending : false })}>{col.label}{sort?.key === col.key ? sort.descending ? " ↓" : " ↑" : ""}</Button></th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t">{data.columns.map((col) => <td key={col.key} className="min-w-24 max-w-sm whitespace-pre-wrap break-words px-3 py-3 [overflow-wrap:anywhere]">{String(row[col.key] ?? "—")}</td>)}</tr>)}</tbody></table></div>}
    {!rows.length && <p className="text-sm text-muted-foreground">{c.noRows}</p>}
  </section>;
}
