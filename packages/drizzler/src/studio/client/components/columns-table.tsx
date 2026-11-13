import { Chip, Table } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { columnAttributes, columnTypeLabel, iconField } from "../features/data/table.js";
import type { GridColumn, GridTable } from "../features/data/table.js";
import { FieldIcon } from "../features/diagram/field-icon.js";
import { MarkedText } from "./marked-text.js";

function TypeLink({ column }: { readonly column: GridColumn }) {
  const label = columnTypeLabel(column);
  if (column.enumName !== null) {
    return (
      <Link
        className="font-mono text-code font-semibold text-enum hover:underline"
        to="/enums/$name"
        params={{ name: column.enumName }}
      >
        {label}
      </Link>
    );
  }
  return <span className="font-mono text-code">{label}</span>;
}

/** A table's columns as the schema declares them, narrowed by the search box above it. */
export function ColumnsTable({
  table,
  query,
  highlight = null,
}: {
  readonly table: GridTable;
  readonly query: string;
  /** One column to point at, for a link that arrived naming it. */
  readonly highlight?: string | null;
}) {
  const primaryKey = useMemo(
    () => new Set(table.columns.filter((c) => c.primaryKey).map((c) => c.name)),
    [table],
  );
  const highlighted = useRef<HTMLTableRowElement>(null);
  // A table of forty columns opens below the one that was asked for, so the row is brought up —
  // again whenever another column is asked for, which does not remount the table.
  useEffect(() => {
    if (highlight === null) return;
    highlighted.current?.scrollIntoView({ block: "center" });
  }, [highlight]);
  const columns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === ""
      ? table.columns
      : table.columns.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.dbName.toLowerCase().includes(q) ||
            c.type.toLowerCase().includes(q) ||
            columnAttributes(c).some((a) => a.toLowerCase().includes(q)) ||
            (c.description ?? "").toLowerCase().includes(q),
        );
  }, [table, query]);
  return (
    <Table variant="secondary" className="studio-table min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
      <Table.ScrollContainer className="min-h-0 overflow-auto">
        <Table.Content aria-label="Columns">
          <Table.Header>
            <Table.Column className="w-9 pr-0" aria-label="Kind" />
            <Table.Column isRowHeader>Column</Table.Column>
            <Table.Column>Type</Table.Column>
            <Table.Column>Attributes</Table.Column>
            <Table.Column>Documentation</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <p className="m-0 px-6 py-8 text-center text-muted">
                No column matches <span className="font-mono text-ink">{query}</span>.
              </p>
            )}
          >
            {columns.map((column) => (
              <Table.Row
                key={column.name}
                id={column.name}
                ref={column.name === highlight ? highlighted : null}
                // The variant paints the cells, not the row, so a whole-row tint is asked of them.
                className={column.name === highlight ? "[&>.table__cell]:bg-accent-soft" : ""}
              >
                <Table.Cell className="w-9 py-2.5 pr-0 pl-3.5">
                  <FieldIcon
                    field={iconField(column)}
                    primaryKey={primaryKey}
                    size={13}
                    className="inline-block align-middle"
                    blank={<span className="inline-block size-[13px] align-middle" />}
                  />
                </Table.Cell>
                <Table.Cell
                  textValue={column.name}
                  className="py-2.5 font-mono text-code font-semibold whitespace-nowrap"
                >
                  <MarkedText text={column.name} query={query} />
                  {column.dbName !== column.name ? (
                    <span className="mt-0.5 block text-meta font-normal text-faint">
                      {column.dbName}
                    </span>
                  ) : null}
                </Table.Cell>
                <Table.Cell textValue={columnTypeLabel(column)} className="py-2.5">
                  <TypeLink column={column} />
                </Table.Cell>
                <Table.Cell textValue={columnAttributes(column).join(" ")} className="py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {columnAttributes(column).map((attribute) => (
                      <Chip
                        key={attribute}
                        color="accent"
                        variant="soft"
                        size="sm"
                        className="font-mono"
                      >
                        {attribute}
                      </Chip>
                    ))}
                  </div>
                </Table.Cell>
                <Table.Cell
                  textValue={column.description ?? ""}
                  className="max-w-[420px] py-2.5 text-muted"
                >
                  {column.description === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <MarkedText text={column.description} query={query} />
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
