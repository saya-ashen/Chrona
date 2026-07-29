"use client";

import { useEffect, useRef, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router-dom";
import { updateGoal } from "../browser-api";
import type { GoalCopy, GoalData } from "../model/goal-types";
import { GoalWorkspaceLayout, type GoalWorkspaceSection } from "./goal-layout";

function sectionFrom(searchParams: URLSearchParams): GoalWorkspaceSection {
  const section = searchParams.get("section");
  return section === "work" || section === "workbench" || section === "criteria" || section === "history" ? section : "overview";
}

function GoalWorkspaceContent({ goal, copy, assetWorkbench }: { goal: GoalData; copy: GoalCopy; assetWorkbench?: React.ReactNode }) {
  const [taskDialog, setTaskDialog] = useState<"task" | null>(null);
  const [renameTitle, setRenameTitle] = useState(goal.title);
  const [renamePending, setRenamePending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [achievementOpen, setAchievementOpen] = useState(false);
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sectionFrom(searchParams);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0; }, [section]);
  const renameGoal = async () => { if (!renameTitle.trim() || renamePending) return; setRenamePending(true); try { await updateGoal(goal.id, { title: renameTitle.trim() }); await revalidator.revalidate(); } finally { setRenamePending(false); } };
  return <GoalWorkspaceLayout goal={goal} copy={copy} assetWorkbench={assetWorkbench} taskDialog={taskDialog} setTaskDialog={setTaskDialog} renameTitle={renameTitle} setRenameTitle={setRenameTitle} renamePending={renamePending} renameGoal={renameGoal} reviewOpen={reviewOpen} setReviewOpen={setReviewOpen} achievementOpen={achievementOpen} setAchievementOpen={setAchievementOpen} section={section} searchParams={searchParams} setSearchParams={setSearchParams} contentScrollRef={contentScrollRef} />;
}

export function GoalWorkspacePage(props: { goal: GoalData; copy: GoalCopy; assetWorkbench?: React.ReactNode }) { return <GoalWorkspaceContent {...props} />; }
