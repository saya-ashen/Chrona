"use client";

import { useState } from "react";
import { useRevalidator } from "react-router-dom";
import {
  CheckCircle2,
} from "lucide-react";
import { useLocale } from "@chrona/i18n";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Textarea,
} from "@shared/ui";
import {
  updateGoalBrief,
} from "../browser-api";
import type {
  GoalCopy,
  GoalData,
} from "../model/goal-types";
import { TaskRow } from "./goal-workspace-tasks";
import { formatDate } from "./goal-workspace-shared";
export function ActiveSummary({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const locale = useLocale();
  const stats = [
    {
      label: copy.tasksSection,
      value: `${goal.projection.completedTaskCount}/${goal.projection.totalTaskCount}`,
      detail: copy.completedShort,
    },
    {
      label: copy.successCriteria,
      value: `${goal.projection.criteriaSatisfiedCount}/${goal.projection.criteriaTotalCount}`,
      detail: copy.confirmedShort,
    },
    {
      label: copy.nextReview,
      value: goal.nextReviewAt ? formatDate(goal.nextReviewAt, locale) : "—",
      detail: goal.nextReviewAt ? copy.scheduledShort : copy.noReview,
    },
  ];
  return (
    <div className="grid border-y border-border/80 sm:grid-cols-3">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={`py-4 sm:px-5 ${index > 0 ? "border-t sm:border-l sm:border-t-0" : ""}`}
        >
          <p className="text-xs font-medium text-muted-foreground">
            {stat.label}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {stat.value}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{stat.detail}</p>
        </div>
      ))}
    </div>
  );
}

// The edit/read modes stay together so one card owns its complete product interaction.
export function OperationalBriefCard({
  goal,
  copy,
}: {
  goal: GoalData;
  copy: GoalCopy;
}) {
  const revalidator = useRevalidator();
  const brief = goal.workbench.brief;
  const [editing, setEditing] = useState(!brief);
  const [outcome, setOutcome] = useState(brief?.outcome ?? goal.description ?? "");
  const [currentFocus, setCurrentFocus] = useState(brief?.currentFocus ?? "");
  const [strategy, setStrategy] = useState(brief?.strategy ?? "");
  const [constraints, setConstraints] = useState(brief?.constraints.join("\n") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!outcome.trim() || !currentFocus.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateGoalBrief(goal.id, {
        outcome: outcome.trim(),
        currentFocus: currentFocus.trim(),
        strategy: strategy.trim(),
        constraints: constraints.split("\n").map((item) => item.trim()).filter(Boolean),
      });
      await revalidator.revalidate();
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.actionError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-l-2 border-info/50 pl-4 sm:pl-5" aria-labelledby="goal-operational-brief">
      <BriefHeader copy={copy} editing={editing} onEdit={() => setEditing(true)} />
      <div className="space-y-4">
        {editing ? (
          <OperationalBriefForm
            brief={brief}
            copy={copy}
            outcome={outcome}
            currentFocus={currentFocus}
            strategy={strategy}
            constraints={constraints}
            saving={saving}
            error={error}
            onOutcomeChange={setOutcome}
            onCurrentFocusChange={setCurrentFocus}
            onStrategyChange={setStrategy}
            onConstraintsChange={setConstraints}
            onCancel={() => setEditing(false)}
            onSave={() => void save()}
          />
        ) : brief ? <OperationalBriefDetails brief={brief} copy={copy} /> : null}
      </div>
    </section>
  );
}

function BriefHeader({ copy, editing, onEdit }: { copy: GoalCopy; editing: boolean; onEdit: () => void }) {
  return <div className="mb-5 flex items-start justify-between gap-3">
    <div>
      <h3 id="goal-operational-brief" className="font-semibold">{copy.operationalBrief}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.briefDescription}</p>
    </div>
    {!editing ? <Button size="sm" variant="ghost" onClick={onEdit}>{copy.editBrief}</Button> : null}
  </div>;
}

function OperationalBriefForm({
  brief, copy, outcome, currentFocus, strategy, constraints, saving, error,
  onOutcomeChange, onCurrentFocusChange, onStrategyChange, onConstraintsChange, onCancel, onSave,
}: {
  brief: GoalData["workbench"]["brief"]; copy: GoalCopy; outcome: string; currentFocus: string; strategy: string; constraints: string; saving: boolean; error: string | null;
  onOutcomeChange: (value: string) => void; onCurrentFocusChange: (value: string) => void; onStrategyChange: (value: string) => void; onConstraintsChange: (value: string) => void; onCancel: () => void; onSave: () => void;
}) {
  return <>
    <BriefFields outcome={outcome} currentFocus={currentFocus} strategy={strategy} constraints={constraints} copy={copy} onOutcomeChange={onOutcomeChange} onCurrentFocusChange={onCurrentFocusChange} onStrategyChange={onStrategyChange} onConstraintsChange={onConstraintsChange} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end gap-2">
      {brief ? <Button variant="outline" onClick={onCancel}>{copy.cancel}</Button> : null}
      <Button disabled={!outcome.trim() || !currentFocus.trim() || saving} onClick={onSave}>{saving ? copy.saving : copy.saveBrief}</Button>
    </div>
  </>;
}

function BriefFields({ outcome, currentFocus, strategy, constraints, copy, onOutcomeChange, onCurrentFocusChange, onStrategyChange, onConstraintsChange }: {
  outcome: string; currentFocus: string; strategy: string; constraints: string; copy: GoalCopy;
  onOutcomeChange: (value: string) => void; onCurrentFocusChange: (value: string) => void; onStrategyChange: (value: string) => void; onConstraintsChange: (value: string) => void;
}) {
  return <>
    <Field><FieldLabel htmlFor="goal-brief-outcome">{copy.outcomeLabel}</FieldLabel><Textarea id="goal-brief-outcome" value={outcome} onChange={(event) => onOutcomeChange(event.target.value)} rows={2} /></Field>
    <Field><FieldLabel htmlFor="goal-brief-focus">{copy.currentFocus}</FieldLabel><Input id="goal-brief-focus" value={currentFocus} onChange={(event) => onCurrentFocusChange(event.target.value)} /></Field>
    <Field><FieldLabel htmlFor="goal-brief-strategy">{copy.strategy}</FieldLabel><Textarea id="goal-brief-strategy" value={strategy} onChange={(event) => onStrategyChange(event.target.value)} rows={3} /></Field>
    <Field><FieldLabel htmlFor="goal-brief-constraints">{copy.constraints}</FieldLabel><Textarea id="goal-brief-constraints" value={constraints} onChange={(event) => onConstraintsChange(event.target.value)} rows={3} /></Field>
  </>;
}

function OperationalBriefDetails({ brief, copy }: { brief: NonNullable<GoalData["workbench"]["brief"]>; copy: GoalCopy }) {
  return <dl className="space-y-5">
    <div className="rounded-lg bg-info/[0.07] px-4 py-3"><dt className="text-xs font-medium text-info">{copy.currentFocus}</dt><dd className="mt-1.5 font-semibold leading-6">{brief.currentFocus}</dd></div>
    <div><dt className="text-xs font-medium text-muted-foreground">{copy.outcomeLabel}</dt><dd className="mt-1 text-sm leading-6">{brief.outcome}</dd></div>
    {brief.strategy ? <div><dt className="text-xs font-medium text-muted-foreground">{copy.strategy}</dt><dd className="mt-1 text-sm leading-6">{brief.strategy}</dd></div> : null}
    {brief.constraints.length ? <div><dt className="text-xs font-medium text-muted-foreground">{copy.constraints}</dt><dd><ul className="mt-2 space-y-1 text-sm">{brief.constraints.map((constraint) => <li key={constraint}>• {constraint}</li>)}</ul></dd></div> : null}
  </dl>;
}

export function FocusQueue({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  const groups = [
    {
      key: "needsYou",
      title: copy.needsYou,
      tasks: goal.workbench.focus.needsYou,
      tone: "border-warning bg-warning/[0.045]",
      countTone: "text-warning",
    },
    {
      key: "inProgress",
      title: copy.inProgress,
      tasks: goal.workbench.focus.inProgress,
      tone: "border-info/60 bg-info/[0.04]",
      countTone: "text-info",
    },
    {
      key: "newResults",
      title: copy.newResults,
      tasks: goal.workbench.focus.newResults,
      tone: "border-success/60 bg-success/[0.04]",
      countTone: "text-success",
    },
    {
      key: "upNext",
      title: copy.upNext,
      tasks: goal.workbench.focus.upNext,
      tone: "border-border bg-card",
      countTone: "text-foreground",
    },
  ].filter((group) => group.tasks.length > 0);
  if (groups.length === 0)
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center">
        <CheckCircle2 className="mx-auto size-7 text-success" aria-hidden />
        <p className="mt-3 font-medium">{copy.focusClear}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy.focusClearDescription}
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section
          key={group.key}
          className={`rounded-xl border-l-[3px] p-4 ${group.tone}`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <span
              className={`text-sm font-semibold tabular-nums ${group.countTone}`}
            >
              {group.tasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {group.tasks.slice(0, 3).map((task) => (
              <TaskRow key={task.id} task={task} copy={copy} goalId={goal.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
