type Problem = {
  readonly title?: string;
  readonly detail?: string;
  readonly errors?: readonly { readonly field: string; readonly message: string }[];
};

function problemOf(error: unknown): Problem | null {
  if (typeof error !== "object" || error === null || !("detail" in error)) return null;
  const detail = error.detail;
  if (typeof detail !== "object" || detail === null || !("data" in detail)) return null;
  const data = detail.data;
  return typeof data === "object" && data !== null ? data : null;
}

/** What went wrong, in the words of the RFC 9457 problem the API answered with. */
export function problemMessage(error: unknown) {
  const problem = problemOf(error);
  if (problem === null) return error instanceof Error ? error.message : String(error);
  const fields = (problem.errors ?? []).map((e) => e.message);
  const detail = problem.detail ?? problem.title ?? "Request failed";
  return fields.length > 0 && !fields.includes(detail) ? `${detail} ${fields.join("; ")}` : detail;
}
