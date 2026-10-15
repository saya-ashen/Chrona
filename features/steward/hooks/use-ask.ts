import { useState } from "react";
import type { Ask } from "@chrona/contracts";
import type { StewardClient } from "../model/client";
import { useStewardMutation } from "./use-steward-mutation";
export function useAsk(ask: Ask, client: StewardClient, refresh: () => void) {
  const [answer, setAnswer] = useState("");
  const mutation = useStewardMutation(refresh);
  const resolve = (input: Parameters<StewardClient["resolveAsk"]>[1]) => mutation.run(() => client.resolveAsk(ask.id, input));
  return { answer, setAnswer, ...mutation, resolve, submitAnswer: () => resolve({ decision: "answer", text: answer.trim() }) };
}
