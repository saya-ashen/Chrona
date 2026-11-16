import { Card, List, SplitPane, Time } from "../ui";
import { useQuery, QueryStatus } from "./query";
import { ChatStream } from "./chat-stream";
import { selectedSession, type ChatSession } from "./chat-messages";
export { openMessages, selectedSession, continueRequest } from "./chat-messages";
export type { Message, ChatSession, ApplicationDelivery, Execution } from "./chat-messages";
export function ChatPage({ path }: { path: string }) {
  const query = useQuery<ChatSession[]>("sessions");
  if (!query.data) return <QueryStatus query={query} />;
  const sessions = query.data,
    current = selectedSession(path, sessions),
    building = sessions.find((session) => session.id === current)?.source === "build";
  return (
    <SplitPane
      sidebar={
        <Card title="会话">
          <a href="/chat/new">新会话</a>
          <List empty="还没有会话。">
            {sessions.map((session) => (
              <a
                key={session.id}
                href={`/sessions/${encodeURIComponent(session.id)}`}
                aria-current={session.id === current ? "page" : undefined}
              >
                {session.title ?? <Time value={session.createdAt} />}
              </a>
            ))}
          </List>
        </Card>
      }
    >
      <Card>
        <ChatStream key={current ?? "new"} props={{ session: current, building: !!building }} />
      </Card>
    </SplitPane>
  );
}
