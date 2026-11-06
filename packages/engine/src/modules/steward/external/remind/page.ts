// The page reads only this application's reminder list.
export const PAGE = {
  id: "main",
  title: "提醒",
  data: { list: { tool: "list" } },
  spec: {
    root: "reminders",
    elements: {
      reminders: { type: "Card", props: { title: "我的提醒" }, children: ["empty", "items"] },
      empty: { type: "Text", props: { text: "还没有提醒。你可以在对话中告诉 Chrona 提醒的时间和内容。", variant: "muted" }, visible: { $state: "/list/reminders/length", eq: 0 }, children: [] },
      items: { type: "Stack", props: { gap: "md" }, repeat: { statePath: "/list/reminders", key: "key" }, children: ["label", "text", "active", "paused", "next"] },
      label: { type: "Heading", props: { text: { $item: "label" }, level: "h3" }, visible: { $item: "label" }, children: [] },
      text: { type: "Text", props: { text: { $item: "text" } }, children: [] },
      active: { type: "Text", props: { text: "等待提醒", variant: "muted" }, visible: { $item: "status", eq: "active" }, children: [] },
      paused: { type: "Text", props: { text: "已暂停", variant: "muted" }, visible: { $item: "status", eq: "paused" }, children: [] },
      next: { type: "Time", props: { value: { $item: "nextAt" } }, visible: { $item: "nextAt" }, children: [] },
    },
  },
};
