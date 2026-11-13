import { buttonVariants, Table } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { LuFileText } from "react-icons/lu";

import { CopyButton } from "../../components/copy-button.js";

type Enum = {
  readonly name: string;
  readonly dbName: string;
  readonly description: string | null;
  readonly values: readonly string[];
};

type Tables = readonly {
  readonly name: string;
  readonly columns: readonly { readonly name: string; readonly enumName: string | null }[];
}[];

/** One enum: its values, and the columns that hold it. */
export function EnumView({ tables, value }: { readonly tables: Tables; readonly value: Enum }) {
  const usedBy = tables.flatMap((table) =>
    table.columns
      .filter((c) => c.enumName === value.name)
      .map((c) => ({ table: table.name, column: c.name })),
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="sticky top-0 z-[2] flex flex-wrap items-center gap-3.5 border-b border-line bg-surface px-6 py-3.5">
        <h1 className="page-title">{value.name}</h1>
        {value.dbName !== value.name ? (
          <span className="font-mono text-ui text-muted">{value.dbName}</span>
        ) : null}
        <span className="text-lead text-muted">
          enum · {value.values.length} {value.values.length === 1 ? "value" : "values"}
        </span>
        <Link
          className={buttonVariants({ variant: "ghost" })}
          to="/schema"
          search={{ focus: value.name }}
        >
          <LuFileText size={15} />
          Drizzle schema
        </Link>
      </header>
      {value.description ? (
        <p className="m-0 px-6 pt-3 whitespace-pre-wrap text-muted">{value.description}</p>
      ) : null}
      <Table variant="secondary" className="studio-table">
        <Table.ScrollContainer className="overflow-auto">
          <Table.Content aria-label={`${value.name} values`}>
            <Table.Header>
              <Table.Column isRowHeader>Value</Table.Column>
              <Table.Column className="w-9" aria-label="Copy" />
            </Table.Header>
            <Table.Body>
              {value.values.map((item) => (
                <Table.Row key={item} id={item}>
                  <Table.Cell className="py-2.5 font-mono text-code">{item}</Table.Cell>
                  <Table.Cell className="w-9">
                    <CopyButton text={item} what={`value ${item}`} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="px-6 py-4">
        <div className="heading">Used by · {usedBy.length}</div>
        {usedBy.length === 0 ? <div className="text-muted">Not held by any column</div> : null}
        {usedBy.map((use) => (
          <div key={`${use.table}.${use.column}`} className="mb-1.5 font-mono text-code">
            <Link
              className="font-semibold text-accent-text hover:underline"
              to="/tables/$name"
              params={{ name: use.table }}
              search={{ tab: "columns", column: use.column }}
            >
              {use.table}
            </Link>
            .{use.column}
          </div>
        ))}
      </div>
    </section>
  );
}
