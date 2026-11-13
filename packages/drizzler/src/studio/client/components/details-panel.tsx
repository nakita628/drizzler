import { Link } from "@tanstack/react-router";
import { LuArrowRight } from "react-icons/lu";

import { columnAttributes, columnTypeLabel, iconField } from "../features/data/table.js";
import type { GridRelation, GridTable } from "../features/data/table.js";
import { FieldIcon } from "../features/diagram/field-icon.js";

const ATTRIBUTE = "pl-5 font-mono text-code break-all text-accent-text";

const INDEX_LABELS: ReadonlyMap<string, string> = new Map([
  ["id", "primary key"],
  ["unique", "unique"],
  ["normal", "index"],
  ["fulltext", "fulltext"],
]);

/** `post.authorId → id · one to many`: the other end first, as the link to follow. */
function RelationLine({ relation }: { readonly relation: GridRelation }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1 font-mono text-code">
      <Link
        className="font-semibold text-accent-text hover:underline"
        to="/tables/$name"
        params={{ name: relation.table }}
        search={{}}
      >
        {relation.table}
      </Link>
      .{relation.otherColumn}
      <LuArrowRight size={12} className="text-faint" />
      {relation.column}
      <span className="text-muted">
        {" · "}
        {relation.kind}
      </span>
      {relation.onDelete ? (
        <span className="text-muted"> · onDelete: {relation.onDelete}</span>
      ) : null}
    </div>
  );
}

/** Everything the schema says about a table, beside its rows: columns, relations and indexes. */
export function DetailsPanel({ table }: { readonly table: GridTable }) {
  const primaryKey = new Set(table.columns.filter((c) => c.primaryKey).map((c) => c.name));
  const relations = table.references.length + table.referencedBy.length;
  return (
    <aside className="overflow-y-auto border-l border-line bg-surface px-5 pt-4 pb-6 text-body">
      <div className="mb-[22px]">
        <div className="heading">Columns</div>
        {table.columns.map((column) => (
          <div key={column.name} className="mb-3">
            <div className="flex items-center gap-1.5">
              <FieldIcon
                field={iconField(column)}
                primaryKey={primaryKey}
                size={13}
                className="inline-block align-middle"
                blank={<span className="inline-block size-[13px] align-middle" />}
              />
              <span className="font-mono text-body font-semibold">{column.name}</span>
              <span className="font-mono text-code text-muted">{columnTypeLabel(column)}</span>
            </div>
            {columnAttributes(column).map((a) => (
              <div key={a} className={ATTRIBUTE}>
                {a}
              </div>
            ))}
            {column.description ? (
              <div className="pl-5 whitespace-pre-wrap text-muted">{column.description}</div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mb-[22px]">
        <div className="heading">Relations</div>
        {relations === 0 ? <div className="text-muted">No relations</div> : null}
        {table.references.map((relation) => (
          <RelationLine key={`to:${relation.table}.${relation.column}`} relation={relation} />
        ))}
        {table.referencedBy.map((relation) => (
          <RelationLine
            key={`from:${relation.table}.${relation.otherColumn}`}
            relation={relation}
          />
        ))}
      </div>
      <div className="mb-[22px]">
        <div className="heading">Indexes</div>
        {table.indexes.length === 0 ? <div className="text-muted">No indexes</div> : null}
        {table.indexes.map((index) => (
          <div key={`${index.type}:${index.columns.join(",")}`} className={ATTRIBUTE}>
            {INDEX_LABELS.get(index.type) ?? index.type} ({index.columns.join(", ")})
          </div>
        ))}
      </div>
      <Link
        className="inline-flex items-center gap-1 font-semibold text-accent-text hover:underline"
        to="/schema"
        search={{ focus: table.name }}
      >
        Open the Drizzle schema <LuArrowRight size={13} />
      </Link>
    </aside>
  );
}
