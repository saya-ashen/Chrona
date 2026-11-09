// App-private presentation. Web expands these templates using only its public
// catalog; business callbacks are supplied by the page that uses them.
const prop = (name: string) => ({ $prop: name });
const event = (name: string) => ({ $event: name });
const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
export const CODING_WEB_COMPONENTS = {
  "coding-web:QuestionCard": {
    props: { type: "object", additionalProperties: false, required: ["title", "help", "confirm", "select", "input", "choices", "answer", "disabled"], properties: {
      title: { type: "string" }, help: { type: "string" }, confirm: { type: "boolean" }, select: { type: "boolean" }, input: { type: "boolean" }, answer: { type: "string" }, disabled: { type: "boolean" },
      choices: { type: "array", items: { type: "object", properties: { questionId: { type: "string" }, label: { type: "string" } }, required: ["questionId", "label"], additionalProperties: false } },
    } },
    events: ["yes", "no", "choose", "answer"],
    spec: { root: "card", elements: {
      card: node("Panel", { tone: "question" }, ["title", "help", "confirm", "select", "input", "answer"]),
      title: node("Heading", { text: prop("title"), level: "h3" }),
      help: node("Text", { text: prop("help"), variant: "muted" }),
      confirm: { ...node("Stack", { direction: "horizontal", gap: "sm" }, ["yes", "no"]), visible: prop("confirm") },
      yes: { ...node("Button", { label: "是", disabled: prop("disabled") }), on: { press: event("yes") } },
      no: { ...node("Button", { label: "否", disabled: prop("disabled"), variant: "secondary" }), on: { press: event("no") } },
      select: { ...node("Stack", { gap: "sm" }, ["choices"]), visible: prop("select") },
      choices: { ...node("Stack", { gap: "sm" }, ["choice"]), repeat: { statePath: prop("choices"), key: "label" } },
      choice: { ...node("ActionOption", { label: { $item: "label" }, disabled: prop("disabled") }), on: { press: event("choose") } },
      input: { ...node("Textarea", { label: "你的答复", name: "answer", value: prop("answer") }), visible: prop("input") },
      answer: { ...node("Button", { label: "提交答复", disabled: prop("disabled") }), visible: prop("input"), on: { press: event("answer") } },
    } },
  },
  "coding-web:ConversationComposer": {
    props: { type: "object", properties: { disabled: { type: "boolean" } }, required: ["disabled"], additionalProperties: false },
    events: ["submit"], slots: ["default", "actions"],
    spec: { root: "composer", elements: {
      composer: { ...node("Composer", { hint: "直接编辑当前对话的项目", footnote: "完成后可以继续对话 · Enter 发送，Shift+Enter 换行", disabled: prop("disabled") }, ["$slot:default"]), slots: { actions: ["$slot:actions"] }, on: { submit: event("submit") } },
    } },
  },
};
