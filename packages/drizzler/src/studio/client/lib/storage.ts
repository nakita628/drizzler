// localStorage can be unavailable (private mode, quota): every value kept here is a convenience,
// so a failed read is the default and a failed write is dropped.

/** The string kept in localStorage under `key`, or null when there is none or storage is unavailable. */
export function loadString(key: string) {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps a string in localStorage; a write the browser refuses is dropped. */
export function saveString(key: string, value: string) {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // The value is a convenience only.
  }
}

/** The JSON value kept under `key`, or null when it is missing or does not parse. */
export function loadJson(key: string): unknown {
  const raw = loadString(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Keeps a value in localStorage as JSON. */
export function saveJson(key: string, value: unknown) {
  saveString(key, JSON.stringify(value));
}
