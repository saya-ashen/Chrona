import { Card, List, Stack, Time, CollapsedText } from "../ui";
import { Approval as ApprovalControl, Question, SystemAction } from "./components";
import { faultText } from "./text";
import { useQuery, QueryStatus } from "./query";
import type { Approval, Interaction } from "./types";
export type { Approval, Interaction } from "./types";
type Run = {
  id: string;
  active: boolean;
  status: string;
  sessionTitle?: string;
  progress?: { phase: string };
  interactions: Interaction[];
};
type Today = {
  health?: { provider: { available: boolean; lastError?: string; name: string } };
  approvals: Approval[];
  problems: {
    moduleId: string;
    module: string;
    incidentStatus: string | null;
    contractFailures: number;
    nextAction: string;
  }[];
  upcoming: { at: string; label?: string | null; mode: string }[];
  updates: {
    id: string;
    title: string;
    createdAt: string;
    body: string;
    status?: string;
    lastError?: string | null;
    feedback?: string | null;
  }[];
  apps: { id: string; name: string; status: string; description?: string }[];
  sessions: { id: string; title?: string | null; key: string; source: string; lastActivityAt: string }[];
};
export function TodayPage() {
  const today = useQuery<Today>("today"), runs = useQuery<Run[]>("runs"),
    runtime = useQuery<NonNullable<Today["health"]>>("runtime");
  return <Stack>
    <QueryStatus query={runtime} />
    {runtime.data && !runtime.data.provider.available ? <p role="alert" className="error">
      Provider 不可用：{runtime.data.provider.lastError ?? runtime.data.provider.name}
    </p> : null}
    <QueryStatus query={runs} />
    {runs.data ? <TodayRuns runs={runs.data} /> : null}
    <QueryStatus query={today} />
    {today.data ? <TodayContent view={today.data} /> : null}
  </Stack>;
}
function TodayRuns({ runs }: { runs: Run[] }) {
  const active = runs.filter(run => run.active),
    questions = runs.flatMap(run => run.interactions.filter(item => item.status === "pending"));
  return <>
      {questions.length ? (
        <Card title={`Chrona 在问你（${questions.length}）`}>
          <List>
            {questions.map((interaction) => (
              <Question key={interaction.id} props={{ interaction }} />
            ))}
          </List>
        </Card>
      ) : null}
      {active.length ? (
        <Card title="正在处理">
          <List>
            {active.map((run) => (
              <Stack row key={run.id}>
                <span>{run.sessionTitle ?? "后台任务"}</span>
                <span className="muted">{run.progress?.phase ?? run.status}</span>
                <SystemAction
                  props={{
                    label: "停止",
                    tool: "cancel",
                    args: { id: run.id },
                    confirm: "停止这次处理？已经做完的部分会保留。",
                  }}
                />
              </Stack>
            ))}
          </List>
        </Card>
      ) : null}
  </>;
}
function TodayContent({ view }: { view: Today }) {
  const failed = view.updates.filter(item => item.status === "failed");
  return (
    <Stack>
      <Card title={`待你决定（${view.approvals.length}）`}>
        <List empty="没有待处理的事项。">
          {view.approvals.map((approval) => (
            <ApprovalControl key={approval.id} props={{ approval }} />
          ))}
        </List>
      </Card>
      {view.problems.length ? (
        <Card title={`需要处理的应用（${view.problems.length}）`}>
          <List>
            {view.problems.map((problem) => (
              <div key={problem.moduleId}>
                <a href={`/apps/${encodeURIComponent(problem.moduleId)}`}>{problem.module}</a>
                <p>
                  {problem.incidentStatus
                    ? faultText(problem.incidentStatus)
                    : `输出不符合契约 ${problem.contractFailures} 次`}
                </p>
                <p className="muted">{problem.nextAction}</p>
              </div>
            ))}
          </List>
        </Card>
      ) : null}
      {failed.length ? (
        <Card title={`未送达的通知（${failed.length}）`}>
          <List>
            {failed.map((item) => (
              <div key={item.id}>
                <strong>{item.title}</strong> <Time value={item.createdAt} />
                <p className="muted">{item.lastError?.slice(0, 160) ?? "通知未能送达。"}</p>
                <a href="/settings">检查通知设置</a>
              </div>
            ))}
          </List>
        </Card>
      ) : null}
      <TodayRecent view={view} />
    </Stack>
  );
}

function TodayRecent({ view }: { view: Today }) {
  return (
    <>
      <Card title="接下来">
        <List empty="七天内没有安排。">
          {view.upcoming.map((item, index) => (
            <Stack row key={index}>
              <Time value={item.at} />
              <span>{item.label ?? item.mode}</span>
            </Stack>
          ))}
        </List>
      </Card>
      <Card title="最近通知">
        <List empty="暂无。">
          {view.updates.map((item) => (
            <div key={item.id}>
              <h3>{item.title}</h3>
              <Time value={item.createdAt} />
              <CollapsedText content={item.body} />
              {item.feedback ? (
                <p className="muted">{item.feedback === "useful" ? "已标为有用" : "已标为没用"}</p>
              ) : (
                <Stack row>
                  {["useful", "not_useful"].map((feedback, index) => (
                    <SystemAction
                      key={feedback}
                      props={{ label: index ? "没用" : "有用", tool: "feedback", args: { id: item.id, feedback } }}
                    />
                  ))}
                </Stack>
              )}
            </div>
          ))}
        </List>
      </Card>
      <Card title="应用">
        <List>
          {view.apps.map((app) => (
            <Stack row key={app.id}>
              <a href={`/apps/${encodeURIComponent(app.id)}`}>{app.name}</a>
              <span className="muted">{app.status === "active" ? (app.description ?? "") : "已暂停"}</span>
            </Stack>
          ))}
        </List>
      </Card>
      <Card title="最近会话">
        <List>
          {view.sessions.map((session) => (
            <Stack row key={session.id}>
              <a href={`/sessions/${encodeURIComponent(session.id)}`}>{session.title ?? session.key}</a>
              <span className="muted">{session.source}</span>
              <Time value={session.lastActivityAt} />
            </Stack>
          ))}
        </List>
      </Card>
    </>
  );
}
