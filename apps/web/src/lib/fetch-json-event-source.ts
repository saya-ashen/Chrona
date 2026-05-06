import {
  fetchEventSource,
  type EventSourceMessage,
  type FetchEventSourceInit,
} from "@microsoft/fetch-event-source";

type JsonEventSourcePayload = Record<string, unknown>;

type JsonEventSourceEvent = {
  event: string;
  data: JsonEventSourcePayload;
  message: EventSourceMessage;
};

type JsonEventSourceOptions = Omit<
  FetchEventSourceInit,
  "onopen" | "onmessage" | "onerror" | "onclose"
> & {
  onEvent: (event: JsonEventSourceEvent) => void;
  onInvalidMessage?: (message: EventSourceMessage, error: unknown) => void;
  onNonStreamResponse?: (response: Response) => Promise<void> | void;
};

class NonStreamResponseHandled extends Error {
  constructor() {
    super("Non-stream response handled");
  }
}

async function toErrorMessage(response: Response) {
  const errorBody = await response.clone().json().catch(() => ({}));
  return (
    (errorBody as { error?: string }).error ??
    `Request failed (${response.status})`
  );
}

export async function fetchJsonEventSource(
  input: string,
  { onEvent, onInvalidMessage, onNonStreamResponse, ...init }: JsonEventSourceOptions,
) {
  try {
    await fetchEventSource(input, {
      ...init,
      openWhenHidden: true,
      async onopen(response) {
        if (!response.ok) {
          throw new Error(await toErrorMessage(response));
        }

        const contentType = response.headers.get("Content-Type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          if (onNonStreamResponse) {
            await onNonStreamResponse(response);
            throw new NonStreamResponseHandled();
          }

          throw new Error(
            `Expected text/event-stream response but received ${contentType || "unknown content type"}`,
          );
        }
      },
      onmessage(message) {
        if (!message.data) {
          onEvent({
            event: message.event || "message",
            data: {},
            message,
          });
          return;
        }

        try {
          onEvent({
            event: message.event || "message",
            data: JSON.parse(message.data) as JsonEventSourcePayload,
            message,
          });
        } catch (error) {
          onInvalidMessage?.(message, error);
        }
      },
      onerror(error) {
        throw error;
      },
    });
  } catch (error) {
    if (error instanceof NonStreamResponseHandled) {
      return;
    }

    throw error;
  }
}
