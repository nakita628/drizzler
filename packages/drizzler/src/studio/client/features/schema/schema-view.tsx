import { useSavedDiagram } from "../diagram/saved-diagram.js";
import { SchemaCanvas } from "../diagram/canvas.js";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The saved schema's ER diagram across the page, fitted to a table when a link names one. */
export function SchemaView({ focus }: { readonly focus: string | null }) {
  const { snapshot, schema } = useSavedDiagram();
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3.5 border-b border-line bg-surface px-6 py-3.5">
        <h1 className="page-title">Schema</h1>
        {schema === null ? null : (
          <span className="text-lead text-muted">
            {plural(schema.models.length, "table", "tables")} ·{" "}
            {plural(schema.relations.length, "relation", "relations")}
            {schema.enums.length > 0 ? ` · ${plural(schema.enums.length, "enum", "enums")}` : ""}
          </span>
        )}
      </header>
      {schema === null || snapshot === null ? (
        <div className="diagram-canvas flex flex-1 items-center justify-center text-body text-muted">
          {snapshot?.parseError ? "The saved schema does not parse." : "Drawing…"}
        </div>
      ) : (
        <SchemaCanvas schema={schema} schemaPath={snapshot.file} focus={focus} />
      )}
    </section>
  );
}
