import { expect, test } from "bun:test";
import { Questions, type QuestionView } from "./questions";

test("live questions bind one structured answer to a method and never persist editor prefill", async () => {
  const views: QuestionView[] = [], questions = new Questions(Date.now() + 5000, view => views.push(view));
  for (const method of ["confirm", "select", "input", "editor"] as const) {
    const promise = questions.ask({ method, title: "Offline dialog", message: "private dialog body", options: method === "select" ? ["a", "b"] : [], timeoutMs: 4000, ...(method === "editor" ? { prefill: "private original editor content" } : {}) }, new AbortController().signal);
    const requestId = views.at(-1)!.requestId;
    expect(() => questions.answer("other-attempt-question", { decision: "cancel" })).toThrow("stale");
    expect(() => questions.answer(requestId, { decision: "submit", value: method === "confirm" || method === "select" ? "wrong-method" : true })).toThrow("method");
    if (method === "select") expect(() => questions.answer(requestId, { decision: "submit", value: 2 })).toThrow("method");
    const answer = { decision: "submit" as const, value: method === "confirm" ? true : method === "select" ? 1 : "edited" };
    questions.answer(requestId, answer); expect(await promise).toEqual(answer);
    expect(views.at(-1)!.status).toBe("answered"); expect(() => questions.answer(requestId, answer)).toThrow("stale");
  }
  expect(JSON.stringify(views)).not.toContain("private"); expect(views.filter(view => view.status === "pending")).toHaveLength(4);
});
test("question expiry, abort, close and bounded concurrency cancel live promises", async () => {
  const views: QuestionView[] = [], questions = new Questions(Date.now() + 5000, view => views.push(view));
  const question = { method: "input" as const, title: "Offline", message: "", options: [], timeoutMs: 1000 };
  const controller = new AbortController(), first = questions.ask(question, controller.signal);
  const requestId = views.at(-1)!.requestId; controller.abort(); expect(await first).toEqual({ decision: "cancel" }); expect(views.at(-1)!.status).toBe("interrupted");
  expect(() => questions.answer(requestId, { decision: "submit", value: "late" })).toThrow("stale");
  const expired = questions.ask({ ...question, timeoutMs: 5 }, new AbortController().signal); expect(await expired).toEqual({ decision: "cancel" }); expect(views.at(-1)!.status).toBe("expired");
  const pending = Array.from({ length: 3 }, () => questions.ask(question, new AbortController().signal));
  expect(await questions.ask(question, new AbortController().signal)).toEqual({ decision: "cancel" }); questions.close(); expect(await Promise.all(pending)).toEqual(Array.from({ length: 3 }, () => ({ decision: "cancel" })));
});

test("failed durable question answer cannot be acknowledged as an effect", async () => {
  let requestId = "";
  const questions = new Questions(Date.now() + 5000, view => { requestId = view.requestId; if (view.status === "answered") throw new Error("journal unavailable"); });
  const promise = questions.ask({ method: "confirm", title: "Offline", message: "", options: [], timeoutMs: 1000 }, new AbortController().signal);
  const failed = promise.catch((error: unknown) => error);
  expect(() => questions.answer(requestId, { decision: "submit", value: true })).toThrow("durably recorded");
  expect(await failed).toEqual(new Error("journal unavailable"));
});
