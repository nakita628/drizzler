import type { ReactNode } from "react";

/**
 * One line for a schema that does not parse, so the page below keeps its room: where the parser
 * stopped, what the page shows meanwhile, and the way to the editor.
 */
export function SchemaErrorBanner({
  error,
  note,
  action,
}: {
  readonly error: { readonly message: string; readonly line: number; readonly column: number };
  /** What the page shows meanwhile, e.g. that the docs are of the last valid version. */
  readonly note: string;
  readonly action?: ReactNode;
}) {
  const summary = `${error.message} (line ${error.line}, column ${error.column})`;
  return (
    <div className="border-b border-danger-line bg-danger-soft text-body text-danger">
      <div className="flex min-w-0 items-center gap-3 px-6 py-1.5">
        <strong className="shrink-0">1 error</strong>
        <span className="min-w-0 flex-1 truncate text-ink" title={summary}>
          {summary}
        </span>
        <span className="hidden shrink-0 text-muted md:inline">{note}</span>
        {action}
      </div>
    </div>
  );
}
