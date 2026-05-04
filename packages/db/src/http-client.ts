class HttpError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.data = data;
  }
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { message: text } : null;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : response.statusText || "Request failed";
    throw new HttpError(message, response.status, payload);
  }

  return payload as T;
}

export function postJson<T>(input: RequestInfo | URL, body?: unknown, init?: RequestInit) {
  return requestJson<T>(input, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
}

export function patchJson<T>(input: RequestInfo | URL, body?: unknown, init?: RequestInit) {
  return requestJson<T>(input, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
}

export function deleteJson<T>(input: RequestInfo | URL, body?: unknown, init?: RequestInit) {
  return requestJson<T>(input, {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
}

