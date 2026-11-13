import { useMemo } from "react";
import { SchemaCanvas } from "../diagram/canvas.js";
import type { CanvasSchema, SchemaHighlight } from "../diagram/types.js";
import type { TouchedTable } from "./touched.js";

/**
 * The saved schema's diagram the whole height of the page: the tables the query touches light up
 * as it is typed, with the columns it names marked, and the rest step back.
 */
export function QuerySchemaPane({
  schema,
  schemaPath,
  parseError,
  tables,
}: {
  readonly schema: CanvasSchema | null;
  readonly schemaPath: string | null;
  readonly parseError: boolean;
  readonly tables: readonly TouchedTable[];
}) {
  const touched = useMemo<SchemaHighlight | null>(
    () =>
      tables.length === 0
        ? null
        : new Map(tables.map(({ table, columns }) => [table, new Set(columns)])),
    [tables],
  );
  // The diagram once the saved schema is drawn; until then why it is not.
  function canvas() {
    if (schema === null || schemaPath === null) {
      return (
        <div className="diagram-canvas flex flex-1 items-center justify-center text-body text-muted">
          {parseError ? "The saved schema does not parse." : "Drawing…"}
        </div>
      );
    }
    if (schema.models.length === 0) {
      return <div className="p-6 text-muted">No tables in the schema.</div>;
    }
    return <SchemaCanvas schema={schema} schemaPath={schemaPath} touched={touched} compact />;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-code text-muted">
        <span className="heading mb-0">Schema</span>
        <span className="truncate">
          {touched === null
            ? "Every table; the ones the query touches light up as you type."
            : `${touched.size} ${touched.size === 1 ? "table" : "tables"} touched · the columns it names are marked`}
        </span>
      </div>
      {canvas()}
    </div>
  );
}
