const ACCESS_KEY_STORAGE_KEY = "chrona.accessKey";

type Listener = () => void;

let memoryAccessKey = readStoredAccessKey();
let accessLocked = false;
const listeners = new Set<Listener>();

function readStoredAccessKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY) ?? "";
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function getAccessKey() {
  return memoryAccessKey;
}

export function isAccessLocked() {
  return accessLocked;
}

export function setAccessKey(key: string, remember: boolean) {
  memoryAccessKey = key;
  accessLocked = false;
  if (typeof window !== "undefined") {
    if (remember) {
      window.localStorage.setItem(ACCESS_KEY_STORAGE_KEY, key);
    } else {
      window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
    }
  }
  emitChange();
}

export function clearAccessKey() {
  memoryAccessKey = "";
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
  }
  emitChange();
}

export function buildAccessKeyHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);
  const accessKey = getAccessKey();
  if (accessKey && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessKey}`);
  }
  return headers;
}

export function buildAccessKeyHeaderRecord(initHeaders?: HeadersInit) {
  const accessKey = getAccessKey();
  if (!accessKey && initHeaders && !(initHeaders instanceof Headers) && !Array.isArray(initHeaders)) {
    return { ...initHeaders };
  }

  return Object.fromEntries(buildAccessKeyHeaders(initHeaders).entries());
}

export function handleUnauthorizedResponse(response: Response | undefined) {
  if (response?.status === 401) {
    clearAccessKey();
    accessLocked = true;
    emitChange();
  }
}

export function subscribeAccessKey(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
