import { redirect } from "next/navigation";
import { createTask } from "@/app/actions/task-actions";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { ControlPlaneShell } from "@/components/control-plane-shell";
import { TaskCenterTable } from "@/components/tasks/task-center-table";
import { resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localizeHref } from "@/i18n/routing";
import { getTaskCenter } from "@/modules/queries/get-task-center";
import { getDefaultWorkspace } from "@/modules/workspaces/get-default-workspace";

const FILTERS = ["Running", "WaitingForApproval", "Blocked", "Failed", "Unscheduled", "Overdue"] as const;

export default async function TasksPage(props: {
  searchParams?: Promise<{ status?: string }>;
  params?: Promise<{ lang?: string }>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const locale = resolveLocale((await props.params)?.lang);
  const dictionary = await getDictionary(locale);
  const t = dictionary.pages.tasks;
  const workspace = await getDefaultWorkspace();
  const activeFilter = FILTERS.includes(searchParams.status as (typeof FILTERS)[number])
    ? (searchParams.status as (typeof FILTERS)[number])
    : undefined;
  const rows = await getTaskCenter(workspace.id, activeFilter);

  return (
    <ControlPlaneShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">{t.createTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.createDescription}</p>
          </div>
          <form
            action={async (formData) => {
              "use server";

              const result = await createTask({
                workspaceId: workspace.id,
                title: String(formData.get("title") ?? ""),
                description: String(formData.get("description") ?? "") || null,
                priority: String(formData.get("priority") ?? "Medium") as "Low" | "Medium" | "High" | "Urgent",
                dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))) : null,
              });

              redirect(localizeHref(locale, `/workspaces/${result.workspaceId}/tasks/${result.taskId}`));
            }}
            className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
          >
            <div className="space-y-3">
              <label className="grid gap-1 text-sm text-foreground">
                <span className="font-medium">{t.titleLabel}</span>
                <input
                  name="title"
                  required
                  placeholder={t.titlePlaceholder}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm text-foreground">
                <span className="font-medium">{t.descriptionLabel}</span>
                <textarea
                  name="description"
                  rows={4}
                  placeholder={t.descriptionPlaceholder}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="space-y-3">
              <label className="grid gap-1 text-sm text-foreground">
                <span className="font-medium">{t.priorityLabel}</span>
                <select name="priority" defaultValue="Medium" className="rounded-md border bg-background px-3 py-2 text-sm">
                  {(["Low", "Medium", "High", "Urgent"] as const).map((priority) => (
                    <option key={priority} value={priority}>
                      {t.priorities[priority]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-foreground">
                <span className="font-medium">{t.dueDateLabel}</span>
                <input name="dueAt" type="datetime-local" className="rounded-md border bg-background px-3 py-2 text-sm" />
              </label>
              <button type="submit" className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                {t.createButton}
              </button>
            </div>
          </form>
        </section>
        <div className="flex flex-wrap gap-2">
          <LocalizedLink
            href="/tasks"
            className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t.all}
          </LocalizedLink>
          {FILTERS.map((filter) => {
            const isActive = activeFilter === filter;

            return (
              <LocalizedLink
                key={filter}
                href={`/tasks?status=${filter}`}
                className={isActive
                  ? "rounded-full border border-primary bg-primary px-3 py-1 text-sm text-primary-foreground"
                  : "rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"}
              >
                {t.filters[filter]}
              </LocalizedLink>
            );
          })}
        </div>
        <TaskCenterTable rows={rows} />
      </div>
    </ControlPlaneShell>
  );
}
