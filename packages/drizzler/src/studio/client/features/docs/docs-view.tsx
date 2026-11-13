import { Chip } from "@heroui/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LuArrowRight, LuKey, LuLink, LuList, LuPlay, LuTable } from "react-icons/lu";
import type { z } from "@hono/zod-openapi";
import type { DocsSchema } from "../../../server/routes/index.js";
import { CodeBlock } from "../../components/code-block.js";
import { useDocs } from "../../hooks/index.js";
import { presetQuery } from "../query/query-view.js";

type Docs = z.infer<typeof DocsSchema>;
type Table = Docs["tables"][number];
type Enum = Docs["enums"][number];

function indexLabel(type: string) {
  if (type === "id") return "PRIMARY KEY";
  if (type === "normal") return "INDEX";
  return type.toUpperCase();
}

function anchor(kind: "table" | "enum", name: string) {
  return `${kind}-${name}`;
}

function TypeName({
  column,
  enums,
}: {
  readonly column: Table["columns"][number];
  readonly enums: ReadonlySet<string>;
}) {
  const type = `${column.type}${column.isList ? "[]" : ""}`;
  return column.enumName !== null && enums.has(column.enumName) ? (
    <a href={`#${anchor("enum", column.enumName)}`} className="text-enum hover:underline">
      {type}
    </a>
  ) : (
    <span className="text-muted">{type}</span>
  );
}

function Columns({ table, enums }: { readonly table: Table; readonly enums: ReadonlySet<string> }) {
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="border-b border-line text-left text-meta text-muted">
          <th className="py-1.5 pr-3 font-semibold">Column</th>
          <th className="py-1.5 pr-3 font-semibold">Type</th>
          <th className="py-1.5 pr-3 font-semibold">Constraints</th>
          <th className="py-1.5 pr-3 font-semibold">Default</th>
          <th className="py-1.5 font-semibold">Description</th>
        </tr>
      </thead>
      <tbody>
        {table.columns.map((column) => (
          <tr key={column.name} className="border-b border-line align-top">
            <td className="py-1.5 pr-3 font-mono">
              <div className="flex items-center gap-1.5">
                {column.primaryKey ? <LuKey className="text-key" aria-label="Primary key" /> : null}
                {column.references !== null ? (
                  <LuLink className="text-accent" aria-label="Foreign key" />
                ) : null}
                <span className="font-semibold">{column.name}</span>
              </div>
              {column.dbName !== column.name ? (
                <div className="text-meta text-faint">{column.dbName}</div>
              ) : null}
            </td>
            <td className="py-1.5 pr-3 font-mono">
              <TypeName column={column} enums={enums} />
            </td>
            <td className="py-1.5 pr-3">
              <div className="flex flex-wrap gap-1">
                {column.primaryKey ? (
                  <Chip size="sm" color="warning" variant="soft">
                    PK
                  </Chip>
                ) : null}
                {column.unique ? (
                  <Chip size="sm" color="success" variant="soft">
                    UNIQUE
                  </Chip>
                ) : null}
                {column.nullable ? (
                  <Chip size="sm" variant="soft">
                    NULL
                  </Chip>
                ) : (
                  <Chip size="sm" variant="soft">
                    NOT NULL
                  </Chip>
                )}
                {column.references !== null ? (
                  <a
                    href={`#${anchor("table", column.references.table)}`}
                    className="inline-flex items-center gap-1 font-mono text-meta text-accent-text hover:underline"
                  >
                    <LuArrowRight />
                    {column.references.table}.{column.references.column}
                  </a>
                ) : null}
              </div>
            </td>
            <td className="py-1.5 pr-3 font-mono text-meta text-muted">
              {column.defaults.join(" ")}
            </td>
            <td className="py-1.5">
              {column.description ?? <span className="text-faint">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Relations({
  title,
  relations,
  reverse,
}: {
  readonly title: string;
  readonly relations: Table["references"];
  readonly reverse: boolean;
}) {
  if (relations.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-meta font-semibold tracking-wide text-muted uppercase">{title}</h4>
      <ul className="flex flex-col gap-1">
        {relations.map((relation) => (
          <li
            key={`${relation.table}.${relation.column}.${relation.otherColumn}`}
            className="flex flex-wrap items-center gap-2 font-mono text-body"
          >
            <span>{relation.column}</span>
            <LuArrowRight className="text-faint" />
            <a
              href={`#${anchor("table", relation.table)}`}
              className="text-accent-text hover:underline"
            >
              {relation.table}.{relation.otherColumn}
            </a>
            <span className="font-sans text-meta text-muted">{relation.kind}</span>
            {relation.onDelete ? (
              <Chip size="sm" variant="soft">
                on delete {relation.onDelete}
              </Chip>
            ) : null}
            {relation.onUpdate ? (
              <Chip size="sm" variant="soft">
                on update {relation.onUpdate}
              </Chip>
            ) : null}
            {relation.origin === "relations" ? (
              <Chip size="sm" color="accent" variant="soft">
                {reverse ? "defineRelations" : "defineRelations (no foreign key)"}
              </Chip>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Drizzle queries to start from, each opened in the Query page as it is written. */
function Queries({ queries }: { readonly queries: Table["queries"] }) {
  const navigate = useNavigate();
  if (queries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-meta font-semibold tracking-wide text-muted uppercase">Queries</h4>
      <ul className="flex flex-col gap-2">
        {queries.map((query) => (
          <li key={query.name} className="rounded-lg border border-line bg-surface-2">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
              <span className="text-body font-semibold">{query.name}</span>
              <span className="truncate text-meta text-muted">{query.description}</span>
              <span className="flex-1" />
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 text-meta text-accent-text hover:underline"
                onClick={() => {
                  presetQuery(query.code);
                  void navigate({ to: "/query" });
                }}
              >
                <LuPlay size={12} />
                Open in Query
              </button>
            </div>
            <CodeBlock code={query.code} className="px-3 py-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableSection({
  table,
  enums,
}: {
  readonly table: Table;
  readonly enums: ReadonlySet<string>;
}) {
  return (
    <section
      id={anchor("table", table.name)}
      className="scroll-mt-4 rounded-xl border border-line bg-surface p-5"
    >
      <header className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="font-mono text-section font-semibold">{table.name}</h2>
        {table.dbName !== table.name ? (
          <span className="font-mono text-body text-muted">{table.dbName}</span>
        ) : null}
        <span className="flex-1" />
        <Link
          to="/tables/$name"
          params={{ name: table.name }}
          search={{}}
          className="text-meta text-accent-text hover:underline"
        >
          Browse rows
        </Link>
      </header>
      {table.description ? <p className="mb-3 text-ui">{table.description}</p> : null}
      <Columns table={table} enums={enums} />
      <div className="mt-4 flex flex-col gap-3">
        {table.indexes.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-meta font-semibold tracking-wide text-muted uppercase">Indexes</h4>
            <ul className="flex flex-col gap-1">
              {table.indexes.map((index) => (
                <li
                  key={`${index.type}:${index.columns.join(",")}`}
                  className="flex items-center gap-2 font-mono text-body"
                >
                  <Chip size="sm" variant="soft">
                    {indexLabel(index.type)}
                  </Chip>
                  {index.columns.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Relations title="References" relations={table.references} reverse={false} />
        <Relations title="Referenced by" relations={table.referencedBy} reverse />
        <Queries queries={table.queries} />
      </div>
    </section>
  );
}

function EnumSection({ value }: { readonly value: Enum }) {
  return (
    <section
      id={anchor("enum", value.name)}
      className="scroll-mt-4 rounded-xl border border-line bg-surface p-5"
    >
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="font-mono text-section font-semibold text-enum">{value.name}</h2>
        <Chip size="sm" variant="soft">
          enum
        </Chip>
        {value.dbName !== value.name ? (
          <span className="font-mono text-body text-muted">{value.dbName}</span>
        ) : null}
      </header>
      {value.description ? <p className="mb-2 text-ui">{value.description}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {value.values.map((v) => (
          <code
            key={v}
            className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-body"
          >
            {v}
          </code>
        ))}
      </div>
    </section>
  );
}

/** The generated documentation of the saved schema: a contents list beside every table and enum. */
export function DocsView() {
  const docs = useDocs().data ?? null;
  if (docs === null) return <div className="p-6 text-muted">Loading…</div>;
  const enums = new Set(docs.enums.map((e) => e.name));
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label="Contents"
        className="min-h-0 overflow-auto border-r border-line bg-surface px-3 py-4"
      >
        <div className="mb-1 flex items-center gap-2 px-2 text-meta font-semibold tracking-wide text-faint uppercase">
          <LuTable /> Tables
        </div>
        {docs.tables.map((table) => (
          <a
            key={table.name}
            href={`#${anchor("table", table.name)}`}
            className="block rounded-md px-2 py-1 font-mono text-body hover:bg-canvas"
          >
            {table.name}
          </a>
        ))}
        {docs.enums.length > 0 ? (
          <>
            <div className="mt-4 mb-1 flex items-center gap-2 px-2 text-meta font-semibold tracking-wide text-faint uppercase">
              <LuList /> Enums
            </div>
            {docs.enums.map((value) => (
              <a
                key={value.name}
                href={`#${anchor("enum", value.name)}`}
                className="block rounded-md px-2 py-1 font-mono text-body text-enum hover:bg-canvas"
              >
                {value.name}
              </a>
            ))}
          </>
        ) : null}
      </nav>
      <div className="min-h-0 overflow-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
          <h1 className="page-title">Schema docs</h1>
          {docs.parseError ? (
            <p className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 font-mono text-code text-danger">
              The saved schema does not parse (line {docs.parseError.line}):{" "}
              {docs.parseError.message}
            </p>
          ) : null}
          <p className="text-body text-muted">
            {docs.tables.length} tables, {docs.enums.length} enums. Generated from the saved file;
            descriptions come from the comment above each table and column (
            <code className="font-mono">{"/** … */"}</code> or{" "}
            <code className="font-mono">{"//"}</code>
            ).
          </p>
          {docs.tables.map((table) => (
            <TableSection key={table.name} table={table} enums={enums} />
          ))}
          {docs.enums.map((value) => (
            <EnumSection key={value.name} value={value} />
          ))}
        </div>
      </div>
    </div>
  );
}
